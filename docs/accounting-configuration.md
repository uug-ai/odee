# ODEE-008 revision 2: configuration publication and financial meaning

**Pre-coding design for coordinator technical review, not delivery or QA approval.**
Source baseline: `051747e8defe83632888bddd21105a4b78eb2e99` (accepted ODEE-007).
Contract: all eleven [ODEE-008 acceptance strings](roadmap/backlog.json),
[D018 finance/atomicity section](roadmap/decisions.md#odee-008-immutable-coexistence-not-instantaneous-revocation);
specification hash `8247a1e4bd9035d3815b9105e67fdaaf19c715a7f5e4bf7d8deb2da825b01754`.
This document chooses implementation semantics within that contract. No production
code, control ledger, grants, shared data or roadmap is changed.

## A. Verified starting points

| Source | Existing behavior to preserve / replace narrowly |
| --- | --- |
| [model.go](../internal/accounting/model.go) `Account`, `Document`, `SetDraft`, `Post`, `RecordPayment` | Eight synthetic starter accounts; document lines persist `accountCode`, quantity, integer `unitCents`, `taxBps`. Entries persist code/debit/credit; payments persist ID/date/amount/reference/entries. There is no configuration identity, journal selection, fiscal-period configuration or frozen account definition yet. `SetDraft` admits only revenue `4000` or expense `5000`; post/payment use hardcoded bindings. |
| [store.go](../internal/accounting/store.go) `ScopeFilter`, `Get`, `Save`, `clone` | `accounting_documents` has ObjectID `_id`, `organisationId`, `projectId`, optional legacy `ownerId`, integer `version`, status, totals, entries, payments, snapshots and embedded `financialEvents`. Save filters ownership + `_id` + expected version, writes financial state/version together and `$push`es the pending event. Memory storage locks and copies; extend its deep copies for new nested data. |
| [http.go](../internal/accounting/http.go) `Handler`, `load`, `post`, `payment`, `apiError` | Strict JSON, 128 KiB default request limit, scoped/version-checked document actions, 409 conflicts, 503 `reconciliation_required` on uncertain saves. State currently returns global `Accounts`. Authentication, origin/CSRF and independent capability checks precede protected work. |
| [audit.go](../internal/accounting/audit.go), [audit_test.go](../internal/accounting/audit_test.go) | Only successful post/manual-payment attribution; at most 201 events (one post + 200 payments). Existing real-Mongo tests inject committed/not-committed acknowledgement loss. No nonfinancial audit extension. |
| [snapshots.go](../internal/accounting/snapshots.go), [company.go](../internal/accounting/company.go), [import_http.go](../internal/accounting/import_http.go) | `newDraft` captures selected partner and configured own-company versions, including review-to-draft. Ordinary edits/post/pay do not refresh them. Preserve explicit contact/manual/company-refresh actions and import retry behavior. |
| [accounting.ts](../web/src/accounting.ts) `journals`/`balances`, [App.tsx](../web/src/App.tsx) `downloadReport`, journal/accounts/reports views | Journals include original and payment entries, but balances key only by code; journal labels resolve current `state.accounts`, and CSV/table iterate that list. These are the actual history-conflation/drop surfaces; there is no separate backend ledger/report engine to replace. |
| [modules.ts](../web/src/modules.ts), [api.ts](../web/src/api.ts), [locale-formats.ts](../web/src/locale-formats.ts) | Reuse accounts route, API/session handling and exact-money helpers. Only 401 expires the session. `MoneyEdit` retains invalid text **and its source locale**; valid edits alone are reformatted on locale switch. |

[007 captures](company-contacts.md), [permissions](permissions.md) and
[localization](localization.md) remain authoritative. A contact/profile IBAN or
`bankAccount` is legal/payment-address metadata, **not** ledger bank account
`1000`, a configured bank binding, permission, tenant ID or evidence of bank
ownership. Preserve absent historical legal snapshots as absent; finance metadata
must not invent or refresh them. Company/VAT/enterprise IDs, actors and import
provenance never supply ownership.

## B. Bounded storage and validation

Use two new collections, not a version array in the company/document:

| Collection / identity | BSON fields (JSON ObjectIDs are hex strings) |
| --- | --- |
| `accounting_configuration`, singleton `_id = configured company ObjectID` | Canonical ObjectID axes and optional legacy owner; `schemaVersion: 1`; `stage: {version: int64, publicationId: ObjectID, data, digest, updatedAt}`; `default: {revision: int64, versionId: ObjectID-or-null}`; bounded `publicationFence: {nonce: ObjectID, versionId: ObjectID}`. Stage version and default revision are independent CAS counters. |
| `accounting_configuration_versions`, `_id = stage.publicationId` | Canonical axes/optional legacy owner; `schemaVersion: 1`; `sourceStageId: ObjectID`, `sourceStageVersion: int64`, `digest`, `publishedAt`, complete `data`. This record is insert-only: no update/delete API or internal normalization write. |
| Existing `accounting_documents` | Add server-owned `configurationSelection` (published ID/digest, or explicit `legacy-starter-v1` policy) and `journalCode` for drafts; add `financialSnapshot` at post. Existing draft `version` remains the CAS counter; ordinary save cannot change selection or posted meaning. |

`data` contains bounded account definitions `{code,name,type,active}`, seven
role mappings (`bank`, `receivable`, `payable`, `revenue`, `expense`,
`vatPayable`, `vatRecoverable`), journals `{code,name,kind,active}`, mappings to
sales/purchase/payment journals, and fiscal years with supported date periods
and enabled flags. It is the entire read unit, never references back to stage.
Only existing invoice/bill/manual-payment operations are supported.

Validation choices:

- Account types remain `asset`, `liability`, `equity`, `income`, `expense`.
  Bank/AR/recoverable VAT require asset; AP/VAT payable liability; revenue income;
  expense expense. References resolve unique codes within this version. No
  inferred account, inferred type or fallback to the current starter list.
- Codes are 1–12 ASCII digits for accounts; bounded journal identifiers are
  independent of legal numbering. Names are 1–200 valid characters. Bound to
  256 accounts, 16 journals, 10 fiscal years, 24 periods/year and 120 periods
  total; cap serialized configuration at 96 KiB within the existing request
  limit. Reject duplicates, malformed dates, reversed/out-of-year periods,
  overlapping fiscal years or overlapping supported periods (inclusive ends).
  Gaps are allowed but unsupported dates cannot post. These are supported-range
  declarations, **not fiscal locks or a close/reopen policy**.
- Stage accepts incomplete mappings and structural editing errors within
  type/size/syntax bounds, with explicit field diagnostics. Publish rejects
  invalid types, conflicting definitions and overlapping/invalid periods, but
  may freeze structurally sound **unready** data. Missing references, inactive
  required accounts/journals and absent supported periods are readiness errors.
- Chosen activation guard: require ready invoice, bill **and original-payment**
  bindings/journals, plus at least one enabled supported period. Inactive unused
  accounts can coexist. This conservative software-readiness check is not
  statutory eligibility. Explicit draft rebind to an unready published version
  remains possible and visibly blocks posting; no silent repair occurs.
  Required invoice roles are bank/AR/revenue/VAT-payable; bill roles are
  bank/AP/expense/VAT-recoverable, including the VAT role on zero-tax documents.
  Sales/purchase and payment journals must support their declared operation.

Generate a fresh server `publicationId` on each successful stage revision.
Digest canonical, deterministically serialized validated data (fixed field
ordering, code/date-sorted collections); never trust a client digest. The `_id`
unique indexes suffice for singleton identity and one publication per stage
revision. Add only published-list indexes:
`{organisationId:1,projectId:1,publishedAt:-1,_id:-1}` and
`{ownerId:1,publishedAt:-1,_id:-1}` for the compatibility branch.
Use scoped keyset pagination (50 maximum), not an all-history state response.
No TTL, automatic deletion or retention trimming of published versions.
Capacity growth/backup retention requires operational monitoring and later
reviewed archival; it must not remove historical references.

Bound the posted projection to at most seven relevant account meanings, post
and payment journal identities, the selected period/range, schema/policy and
configuration identity/digest. Do not embed the full chart or every version.
Keep existing 100-line, 200-payment and 201-event limits; validate final BSON
size below 2 MiB before a new mutation (well below MongoDB's 16 MiB ceiling).
Oversize historical data remains readable and gets an explicit mutation error,
not pruning. Memory storage must copy every nested configuration/projection.

**No-backfill scope:** use existing `ScopeFilter(company)` for every collection
read/write and ID resolution, including singleton and published-history reads.
Each missing/null/empty/zero axis independently uses a valid nonzero BSON
`ownerId`; a nonempty canonical axis wins, including a foreign one. Unknown BSON
types are not coerced into ownership. Normalize decoded compatible empties
before domain checks, without rewriting nonempty fields. Mutable successful
writes can fill only missing axes under the same scoped CAS; immutable version
reads need no normalization write. Test both partially missing axes as well as
both missing. No new index or migration is a prerequisite for compatibility.

## C. Ordering, durability and exact operation behavior

### Durability boundary

Baseline `Save` proves single-document atomicity, **not explicit journal
durability**: its call has no write-concern override. Do not infer durability
from `SetRetryWrites(true)`, a successful local read, default URI options or a
normal shutdown. Implement operation/collection-scoped
`{w:"majority", j:true, wtimeout:5000}` for configuration and financial writes,
using the existing native-client precedent in
[MongoImports](../internal/accounting/import_store.go). MongoDB's
[write-concern manual](https://www.mongodb.com/docs/manual/reference/write-concern/)
explicitly supports standalone `w:"majority",j:true` as on-disk journal
acknowledgement; this does **not** require a replica set. Keep bounded request
contexts (the current HTTP budget is 10 seconds), inspect write-concern errors,
and never downgrade concern on failure.

Assume persistent WiredTiger storage whose journal/fsync is honored; no
in-memory-engine, power-loss hardware, malicious database writer, backup-restore
consistency or HA certification is claimed. Reads use the authoritative
standalone/primary, not a secondary cache. Memory mode has equivalent visibility,
immutability/CAS/copy semantics but explicitly no restart durability.

**Uncertain publication recovery needs more than a read.** Before *every*
default-pointer update, resolve the immutable version, then perform an actual
write of a fresh `publicationFence.nonce` and its target ID in the singleton
with the above concern; await its successful acknowledgement, and re-resolve
the target before the pointer CAS. This fixed-size internal fence changes no
published bytes, stage revision or default revision. It uses ordinary document
write privileges, not `fsync`, a transaction or an admin lock.
[MongoDB journaling](https://www.mongodb.com/docs/manual/core/journaling/)
describes journal records and crash replay; the write-concern manual specifies
that `j:true` causes immediate journal synchronization. The design relies on
the same authoritative server's ordered journal: synchronizing this **real**
write also makes the previously completed, observed immutable insert durable.
Do not substitute a no-op update, duplicate-key response or sleep for the fence.
If failover/re-resolution loses the target, or the fence times out, do not
attempt the pointer write. Independently fault-test this assumption on the
supported standalone Mongo version before accepting implementation.

| Operation | Reads, validation, writes, response/reconciliation |
| --- | --- |
| Stage | `read+admin`; read scoped singleton, compare `expectedStageVersion`. Absent singleton means stage/default revisions 0 and no configured default. Insert on first save with stage version 1 and default `{revision:0,versionId:null}` (duplicate `_id` → 409); otherwise scoped `_id + stage.version` update of **stage only**, with new publication ID/digest and stage version +1. Concurrent activation does not lose either subdocument. Success only after durable ack. Dispatch/ack uncertainty → 503; reread stage revision/digest; do not blindly resend an old stage over a newer edit. |
| Publish | `read+admin`; request includes `expectedStageVersion` and observed `publicationId`. First check a matching scoped published ID for reconciliation; otherwise read one complete stage revision and require both values to match. Freeze that copy, validate, insert immutable version with that ID and durable concern. No head-pointer change. For an existing ID verify requested scope/source identity and recomputed content digest; after duplicate insert also compare the attempted snapshot to the winner (excluding `publishedAt`). An idempotent durable result additionally requires the fresh durability fence; mismatch → conflict/integrity error. An uncertain insert returns 503 with target ID; scoped lookup reconciles presence, and activation still requires the durability fence. Never report “durably published” solely because an uncertain insert was readable. A successful fresh insert ack establishes durability directly. |
| Publish vs edit | A later stage edit can win before publication's insert: publishing the **complete previously read revision** is allowed, and response names that source revision. It never means “published the latest stage.” A stale version detected at the stage read is 409. No cross-record lock or atomic stage-validation claim. Same-revision publishers converge on one immutable `_id`; edits generate another ID. A retry can resolve the earlier ID even after staging moves on. |
| Activate | `read+admin`; request `{versionId, expectedDefaultRevision}`. Resolve/validate scoped published target, not stage; require readiness. Read/compare default revision, run the fresh durable fence, re-resolve target, then scoped singleton `_id + default.revision` CAS of `default.versionId` and revision +1. Stage edits/fences do not affect that counter. A competing activation → 409, including stale same-target activation. Reply only after pointer ack. On uncertainty, return 503 and require authoritative pointer/revision read: desired target at expected+1 reconciles the desired state, not actor attribution. A later revision may already supersede it; require a new explicit decision with that revision, never an automatic overwrite. |
| Create draft (including review) | `read+write`; server observes default once, resolves that immutable target and returns/persists its selection with document creation. No configured default means explicit `legacy-starter-v1`; an existing but broken pointer is an error, **not** starter fallback. Activation during selection may yield either actually observed complete version. Preserve submitted line codes. Initial journal is the selected version's declared kind-specific journal, or visibly unresolved. Existing contact/own-company capture semantics remain. Creation ack uncertainty returns the generated document ID with 503; reconcile via scoped state before creating another draft. Review retains its existing deterministic document ID = import ID and source-link reconciliation, so retries return the already-bound draft, not a newly selected default. |
| Edit / explicit rebind | Ordinary expected-document-version edits retain selection and journal. Dedicated `POST /api/documents/{id}/configuration` requires `read+write`, `{version, targetVersionId, journalCode?}`; server resolves a scoped published target, updates selection only (journal only if explicitly supplied), and saves with document CAS. It never rewrites lines, totals or legal captures. A mismatch between existing line codes/journal and target becomes a visible readiness error, not substitution. Draft saves retain syntactically valid unresolved codes for explicit correction; posting remains blocked. Metadata-free drafts stay legacy on ordinary save. Rebind of posted/paid docs is rejected. |
| Post | `read+post`; load scoped document at expected version; resolve **its selection** (legacy only when identified), validate its immutable active flags, required mappings incl. later bank/AR-or-AP, journal/kind and document date in an enabled supported period. Validate line codes against that selected revenue/expense mapping. Use unchanged integer calculation/balance rules. Construct entries and bounded frozen projection, attach existing financial event, then one scoped `_id + version + status:draft` write for state/entries/snapshot/version +1/event append. No reread of the default. Neither success nor event exists for a validation rejection. |
| Manual payment | `read+post`; load scoped posted document at expected version, resolve frozen original bank and AR/AP/journal meaning; **do not read active configuration or stage**. Preserve existing status/date/id/key-length/positive/outstanding/reference/200-payment checks and duplicate-key rejection (not an invented successful idempotent response). Apply entries, paid/status, snapshot if recognized legacy, version +1 and event in one scoped/versioned, posted-status-filtered write. No new payment fiscal-period restriction/lock. |

Financial writes retain the event target/version/capacity guard and extend the
existing injectable write boundary for both committed and uncommitted failures.
Known zero-match CAS → 409; an error after dispatch or write-concern timeout →
503 `reconciliation_required`, not success or automatic retry. Read latest
document plus admin financial history to distinguish committed event/version/
snapshot/payment key from unchanged state. Posters without admin can inspect
their document/payment key and ask an admin to reconcile attribution; no extra
permission is implied. A committed retry with the old version conflicts; a
duplicate payment key at the current version is rejected with no new event.
If state is unchanged, retry only after reconciliation with its current version
and the **same** payment key. An unresolved/later conflicting outcome remains
uncertain, not an exactly-once claim.

## D. Crash, timeout and race obligations

These are required assertions, not claims that tests have already run.

| Boundary / injected failure | Required stored/visible state and recovery |
| --- | --- |
| Before publication dispatch, or rejected stage/publication | No new published target or pointer change. Staging may exist independently. Retry only with observed stage identity/version. |
| Insert dispatched, ack lost; process/Mongo crashes before confirmed durability | Published target may be absent or whole; never partial. Old default remains. Return/read reconciliation, not success. If present, activation must fence before CAS; if absent, matching retained stage may republish the same ID, otherwise stage conflict requires review. |
| Durable publication ack, crash before any activation | Published bytes survive hard restart, old default remains. Historical list exposes the inactive version; explicitly activate using current default revision. |
| Fence before/after ack, crash before pointer CAS | Old default remains. Fence is not activation or public approval. A lost fence ack never authorizes pointer CAS; a retry uses a fresh nonce and checks the current pointer. |
| Target missing, invalid/unready, foreign, or replaced/mutated outside application | No pointer update; explicit integrity/not-found/readiness error. No starter/stage fallback. External writes/deletion are outside application authority, not silently repaired. |
| Pointer CAS stale, including ABA V1→V2→V1 | Revision is monotonic, so old expected revision conflicts even if ID matches. Neither stage nor immutable data changes. |
| Pointer write commits but ack lost / app exits before response | Pointer may be old or new; read exact revision/ID. Successful durable pointer must never survive restart with a missing target. Later activation is not overwritten by an old retry. |
| Stage edit and publish/activate overlap | Publish references a whole named observed stage revision; activation references that immutable version. New stage data is not mixed into either operation. Stage and pointer counters independently preserve both winning writes. |
| Draft selection/rebind overlaps activation | Selection is the version actually resolved, persisted/returned unchanged. Existing drafts do not migrate. Rebind-vs-edit/post on the same document has exactly one CAS winner; loser gets conflict and no financial event. |
| V1 post overlaps V2 activation | Entire V1 mappings, flags, journal, period, entries and payment projection commit, or document CAS loses. V2 default cannot revoke V1 or leak any V2 binding into the write. |
| Rejected/stale/denied post or payment | All financial fields/version/entries/snapshots/history remain byte-equivalent to pre-request state; no committed event. |
| Post/payment dispatch or ack loss, then hard restart | Either old document/no event, or whole new document including version/snapshot/exactly one event. Reconcile via version/status/key/history; never create a second payment/event on stale retry. |

Independent integration tests must inject pre-write and **after actual write**
acknowledgement loss, control stage/pointer/document races with barriers, and
kill only owned app/Mongo PIDs at these boundaries. Restart on the same owned
disk path, without database cleanup between phases. Assert raw BSON plus HTTP
state after restart, successful journaled publication before pointer, and no
partial financial write. A graceful stop/reconnect, successful shutdown handler,
mock-only memory test or immediate readback is insufficient crash evidence.
Observe actual command concern/fresh fence writes; test fence uncertainty and
that no pointer command is issued after it fails.

## E. Frozen meaning and historical coexistence

At post, freeze selection identity/digest (or named legacy policy), mapping
roles, original code/name/type for each used account **including future bank
and AR/AP**, post/payment journal definitions, and the selected period.
Server inputs only; reject client selections/snapshots on ordinary draft or
post requests. Retain the original entry code/debit/credit fields unchanged.
New payment entries resolve against this frozen projection, even if current
versions remove a code or reuse it with a different name/type/role.

Recognize `legacy-starter-v1` from an explicit policy binding or metadata-free
records conforming to the baseline's known EUR invoice/bill starter shape:
known kind/status, supported stored amounts/lines, starter line mapping and,
for posted records, exactly the baseline posting equations and recorded payment
equations/totals/status. Compare for recognition; **do not recalculate/rewrite
history**. This rule relies on the documented baseline writer, not on account
codes alone or guessed imported provenance. Contradictory/unknown configuration
metadata, custom/unknown entries, malformed projections or unrecognized meaning
are not eligible for starter fallback. There is no cryptographic provenance for
old metadata-free rows; indistinguishable externally fabricated rows cannot be
authenticated by this compatibility rule.
An explicit legacy policy tag does not exempt stored entries/snapshots from
integrity checks or authorize arbitrary unknown account meaning.

Known metadata-free drafts remain editable/postable under that named starter
policy until explicit rebind. Known old posted documents use original starter
payment rules; their first successful payment can persist the identified-policy
projection in the same financial CAS without changing original entries or legal
snapshots. Unknown meaning blocks financial mutation explicitly but does **not**
hide historical entries. Missing/deleted published references never silently
become legacy.

API state includes per-document stored meaning, or a clearly identified runtime
legacy/unresolved projection; this is not a fabricated captured snapshot.
Use one frontend resolver for journal, document details, balances and CSV:

- Key known balances by **scope + configuration ID/policy + digest + account code**,
  with original name/type/currency. Conservatively keep different published
  versions separate even when labels happen to match. Display version/policy
  beside repeated codes; no bare-code React keys or `state.accounts.find`.
  Inconsistent frozen definitions under one identity are unresolved/integrity
  diagnostics, not permission to merge conflicting meanings.
- Iterate the union of **all original/payment entry meaning keys**, not the
  current chart. Unknown entries retain their exact amount/code and get an
  explicit “meaning unknown” row keyed by document/journal/entry identity.
  Do not assign current type/name or merge unresolved rows by code.
- Trial balance/table/CSV carry configuration/policy, code, original name/type,
  resolution status and exact debit/credit; include every journal entry.
  Unknown typing precludes claims about classified/statutory reports but never
  removes entries from debit/credit totals. Do not mix currencies. Preserve
  integer/BigInt totals, decimal-string CSV values and `csvCell` protections.
- Chart settings show selected/current configuration separately from historical
  balances. Stock translations apply only to the identified starter policy and
  matching original stock name, never a custom definition with a reused code.

No generalized finance engine, chart remapping of history, automatic transfers,
legal numbering, fiscal lock, opening-balance import or new financial math.
Quantities/discount/tax-policy changes remain ODEE-009.

## F. API/UI and eligibility boundary

Proposed configuration routes:
`GET /api/accounting-configuration` (stage/default/readiness);
`PUT /api/accounting-configuration/stage`;
`POST /api/accounting-configuration/versions`;
`GET /api/accounting-configuration/versions` (paged) and `/{id}`;
`POST /api/accounting-configuration/activate`.
Read routes require `read`; all three mutations require **read+admin**.
Draft creation/edit/rebind requires **read+write**; post/payment **read+post**.
Admin implies neither read, write nor post. No published update/delete route.

Reuse `/accounting/accounts` for accessible stage editor, explicit Publish and
Make default actions, immutable version review and readiness diagnostics; retain
007 legal settings separately. Display expected stage/default revisions and
publication source revision, never misleading “latest approved chart” language.
Show the selected binding/journal on draft and document views, explicit
draft-only rebind confirmation, and unresolved line/mapping errors. Rebind is
an intentional saved action; cancelling has no write. Old drafts remain
labeled V1/legacy after V2 becomes default.

Catalog all labels, field diagnostics, confirmations, 409 and configuration/
financial 503 recovery instructions in EN/NL. Keep machine error codes/IDs/
capabilities stable. 403 stays authenticated with actionable permission text;
no automatic write retry. Preserve keyboard labels/focus/error association and
mobile table access. Locale switching never saves, rebinds, changes an ISO date
or turns invalid `MoneyEdit` text valid under another locale. Keep legal/company
and partner captured data original, not translated or refreshed.

Publication and Make default are software operations, not legal approval,
Peppol readiness or payment authorization. Unassessed/unsupported tax
applicability is retained; no new tax eligibility condition is inferred from
VAT/IBAN checks or configuration readiness.

## G. Belgian mapping evidence and professional gates

The eight starter numeric codes are **synthetic existing application policy**,
not Belgian statutory PCMN/MAR mappings. Support explicit reviewed mapping
definitions; do not ship a guessed “Belgian compliant” starter conversion.
Record a bounded human-readable mapping/source note in configuration data
(maximum 2,000 characters, no executable URLs/provider calls).

Evidence scope, checked 2026-11-04:

- The accepted [ODOO-BELGIUM record](roadmap/capabilities.json) pins official
  [Odoo 20.0 Belgium documentation](https://www.odoo.com/documentation/20.0/applications/finance/fiscal_localizations/belgium.html)
  retrieved 2026-11-03. It lists localization capabilities; individual statutory
  mappings/module entitlements were **not audited**. Reuse this baseline; no
  new catalog crawl, proprietary implementation or Odoo service integration.
- The Belgian Accounting Standards Commission
  [CNC/CBN official portal](https://www.cbn-cnc.be/) is the PCMN/MAR reference
  authority to consult, alongside consolidated legislation from
  [SPF Justice / Justel](https://www.ejustice.just.fgov.be/).
  Direct attempted French/Dutch CNC PCMN/MAR pages returned **403** in this
  environment; their contents/current annexes are unverified here. An attempted
  Justel decree deep link returned the ELI-help/no-result page, **not legislation**.
  No table, decree number, current annex or individual Belgian binding is
  asserted on that evidence; third-party search summaries are not substituted.
- Existing [BE-APPLICABILITY](roadmap/capabilities.json) government guidance
  addresses e-invoicing scope, **not** chart-account correctness. Identifier
  checks from 007 and balanced journals establish neither statutory
  completeness nor applicability.

Accountant-open decisions before statutory use: applicable entity/chart regime
and authoritative current text/annex; reviewed bank/AR/AP/VAT/sales/expense
accounts and subdivisions; tax/report classifications and deductibility;
journal choices and fiscal-year/period coverage; treatment of preexisting
balances and any deliberate history consolidation. These are not solved by
copying a chart or passing synthetic fixtures. Software activation may be
tested locally; shared/live configuration, qualified mapping/legal review,
release/deployment and actual filings/Peppol/payments remain professional/human
gates. No live action is part of this feature.

## H. Implementation sequence and independent test matrix

After coordinator design review, continue **the same retained feature**:

1. Add bounded configuration/domain/store code and tests under
   `internal/accounting/` (e.g. `configuration*.go`); extend `Store` with the
   narrow configuration operations implemented by existing Mongo/Memory stores.
   Pass the configured company to those operations; Mongo checks its own company
   and memory keeps scope-keyed maps, without changing the existing constructor.
   This avoids a new dependency injected from `cmd/odee/main.go`. Initialize
   required indexes through accounting code; no new startup flag, manifest,
   lockfile, tool or main wiring is necessary. Preserve fault-injection seams.
2. Extend existing model/store/HTTP/snapshot/review paths for selection,
   explicit rebind, journal/readiness and frozen payment meaning; retain
   financial CAS/event and legal capture contracts. Add source-linked
   permissions/company/localization documentation updates within `docs/`.
3. Implement accounts controls and history resolver in `web/src/` (types,
   accounting helpers/App or a bounded component, modules and both catalogs).
   No separate backend report engine or broad settings rewrite.
4. Add normal-discovered tests under `web/tests/` and Go tests. Bind evidence
   to implementation SHA/revision/hash; implementation author does not verdict
   itself. No roadmap/state/lease expansion.

| Independent area | Required oracle / negative and recovery assertions |
| --- | --- |
| Ledger: invoice V1 → V2 | Net **20000**, VAT **4200**, total **24200 cents**: DR `1100` 24200; CR `4000` 20000; CR `2100` 4200. After V2 changes AR/bank, pay **10000**: DR original `1000` 10000; CR original `1100` 10000; outstanding **14200**. Original entries unchanged, both journals balanced, frozen meanings survive restart. |
| Ledger: bill counterpart | DR `5000` 20000; DR `1200` 4200; CR `2000` 24200. After V2, payment DR original `2000` 10000; CR original `1000` 10000; payable **14200**. Same-code/different-name/type V2 entries stay separate in detail/journal/trial balance/CSV, no lost entries. |
| API/data | Exact BSON scope matrix on stage/head/history/doc/rebind/post/pay: missing/null/empty/zero canonical axes independently, valid owner, invalid/missing owner, nonempty foreign canonical precedence. Wrong IDs/types/snapshots denied; historical reads require no backfill. Size limits/deep-copy immutability and no published update/delete surface. |
| Configuration / binding | Invalid types/overlaps; missing/inactive role/account/journal, unsupported selected journal/date. Publish unready is visible; activation rejects it. Explicit rebind can expose unresolved lines without changing them. V1 drafts/post remain valid after V2 default; absent metadata stays named legacy until rebind; unknown meaning fails financial actions but retains report entries. |
| Concurrency / faults | Every row in section D, including publication/edit overlap, same-revision duplicate publish, stale/ABA activation, real durability fence and no-pointer-after-fence-error, V1-post/V2 race, two payments/edit/rebind CAS; actual committed/uncommitted uncertain writes plus hard app and Mongo disk restart. No rejected operation creates an event. |
| Permissions/browser | Direct HTTP capability combinations (including admin-only), read-only configuration/history, real EN/NL stage→publish→activate→draft→rebind→post→partial pay, stale conflicts, 403 without logout and 401 regression, accessible keyboard/mobile flows and preserved company/contact captures. |
| Localization | Exact cents/BigInt/CSV/ISO invariance; both locale catalogs and invalid-money source-locale provenance on existing draft/review/payment forms after repeated switches; custom historical account names never translated as starter merely by matching code. |
| Belgian/Peppol | Independently inspect source notes, unverified references/open decisions, explicit synthetic labels and statutory/live gates; verify no inferred tax applicability, Peppol transmission, bank transfer or statutory approval. |

**Normal-CI reachability is mandatory.** Existing
[check.yml](../.github/workflows/check.yml) runs `go test -race ./...`,
frontend Vitest/build, `npm run test:mongo`, normal `npm run test:e2e`,
scan and persistence runners. No workflow/package changes are needed:

- Name persistent cases `TestMongoConfiguration...` so the existing
  [mongo selector](../web/tests/company-test-results.mjs) already selects them;
  add their exact names/children to its mandatory pass assertions.
  Extend `TestMongoDiskPersistence`'s write/read phases with configuration,
  pointer, selected/frozen/payment meaning assertions and explicit required
  passing children. Add the hard-crash phases to the **normal**
  [mongo runner](../web/tests/mongo.mjs), not a manual-only script.
- Add `configuration.spec.ts` as a normal parent adapter, using the accepted
  [company adapter](../web/tests/company.spec.ts)/owned-fixture/result-gate
  patterns. Its bounded child config selects only fixture bodies and transport
  guards, never its parent; assert exact required child names/results, zero
  skips/flakies/unexpected passes and no recursive launch. Permanent
  destination-enforced [local transport](../web/tests/local-transport.mjs)
  registers only owned exact numeric loopback origins. **Every browser and
  API context** uses its explicit proxy/`<-loopback>` boundary; no-follow/
  zero-retry API wrappers and bounded health checks. No external fonts/app/
  provider requests, shared 8098 or route-only redirect protection.
- Reuse `safeTestEnvironment`, `NODE_ENV=test`, explicit production build mode,
  `GOWORK=off`, owned scratch under the worktree and synthetic grants/OAuth/
  Mongo/originals. Reuse bounded child termination/result collection; preserve
  disk data until restart assertions finish, then clean only owned resources.
  Do not run or claim to fix the historical unsafe broad demo launcher.

Focused implementation selectors: Go `go test -race -count=1
./internal/accounting` with disposable Mongo, then normal `npm --prefix web run
test:mongo`; `npm --prefix web test -- accounting.test.ts` plus new configuration/
catalog tests; sanitized production build; normal `npm --prefix web run test:e2e
-- configuration.spec.ts`, followed by affected accepted company/localization/
persistence regressions through their guarded fixtures. Independent QA must also
verify that **unfiltered normal selection** reaches all required new children,
not accept selector-only green evidence. Dependencies are restored only after
missing-dependency failure; none are needed for this documentation phase.
The normal [Playwright config](../web/playwright.config.ts) still starts the
historical demo server and its own health check even for an adapter-only
selector: execute those parent selectors through a launch-only safety wrapper/
guarded parent config, preserving normal discovery and permanent child guards.
Do not execute that historical launcher unguarded or describe the wrapper as
its permanent repair.

Required later roles remain `qa-api-data`, `qa-integration`, `qa-ledger`,
`qa-belgian-peppol`, `qa-browser`, `qa-localization`, sequenced by coordinator
with **at most two active**, exact-candidate evidence and independent expected
calculations. Existing dependencies are 005+006; accepted 007 precedes this
work by priority/shared leases, not a newly invented graph dependency.

**Review points, not implementation authorization:** verify the journal-fence
assumption and conservative activation-readiness choice above. No known
out-of-lease code wiring blocker; if implementation disproves that, return a
narrow proposal before touching excluded paths. Missing verified Belgian
annex/accountant mapping remains an explicit statutory-use gate, not authority
to invent mappings and not a blocker to synthetic software implementation.
