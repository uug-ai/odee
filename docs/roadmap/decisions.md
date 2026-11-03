# PM decisions and feedback protocol

Initial planning record, **2026-11-03**. Entries below describe requirements and
observations, not completed feature tickets or QA approvals.

## D001 — Preserve the agreed product and ownership invariants

**Decision:** one company first; accounting and contacts precede the broader
suite; Belgium with Peppol both ways; EN/NL. Build original Go/React/MongoDB
workflows, not copied Odoo code or a collection of enabled placeholder tiles.
Finance owns posting formulas; downstream apps call its services.

The [source model](../../internal/accounting/model.go) and
[scope filters](../../internal/accounting/store.go) use BSON ObjectIDs and
`organisationId`/`projectId` with `ownerId` compatibility. Preserve valid owner
fallback for each missing canonical axis at runtime, without requiring backfill.
Existing nonempty axes outrank provenance. A future legal-company identifier,
GitHub actor or imported Odoo company does not reassign existing resources.

**Authority:** user-approved scope/session plan. PM can reprioritize or split
within this suite, not remove accepted functionality, rewrite posted history,
grant itself QA approval or invent a new product family.

## D002 — Pin verified stable Odoo 20.0, not an annual guess

**Evidence retrieved 2026-11-03:**

- [Official documentation entry](https://www.odoo.com/documentation/) redirected
  to [20.0](https://www.odoo.com/documentation/20.0/), whose title names 20.0.
- [Official support table](https://www.odoo.com/documentation/20.0/administration/standard_extended_support.html)
  lists Odoo 20.0 released September 2026, separately from Online SaaS 19.x.
- [Official release index](https://www.odoo.com/page/release-notes) links
  [Odoo 20 release notes](https://www.odoo.com/odoo-20-release-notes), which name
  September 2026.

**Decision/confidence:** 20.0 is the latest verified stable reference, **high
confidence**, based on convergent official retrieved content, not today's year
or a presumed release cadence. `master` and unverified future features are
excluded. `web_fetch` failed for Odoo; official-source web search was followed
by successful direct `curl` retrieval of HTML. Search-generated summaries
included uncertain paths/claims; only independently retrieved canonical pages
are recorded in the [source manifest](capabilities.json).

**Change rule:** a newly verified stable release prompts a relevant capability
delta at a planning checkpoint. Do not silently change a ticket already under
development. If retrieval later fails, retain dated verified evidence, mark the
new claim unverified and block only the dependent decision.

## D003 — Cover Community and public Enterprise without asserting parity

The [official editions comparison](https://www.odoo.com/page/editions) was
retrieved including its Community/Enterprise column headings and icon cells.
Invoicing and Payments are checked in both. Accounting and Comprehensive
Accounting are crossed in Community and checked in Enterprise; the latter
lists ledger, reconciliation, analytics, OCR, budgets and reports. The
[20.0 EDI guide](https://www.odoo.com/documentation/20.0/applications/finance/accounting/customer_invoices/electronic_invoicing.html#accounting-e-invoicing-peppol)
explicitly documents Community Peppol registration.

**Decision:** public Enterprise workflows are legitimate functional references
for the approved suite, not an obligation to acquire Enterprise or reproduce
its proprietary implementation. The edition page is an unversioned dated
snapshot; individual guide paragraphs/localization modules may be
edition-unspecified. Keep that uncertainty instead of labelling everything
“Community” or “Enterprise.” No complete feature parity is claimed.

Only accounting/contact essentials were researched now. Future epics remain
unverified at feature level until their bounded planning checkpoint.

## D004 — Law and standards override a simplified product guide

The [Odoo Belgium guide](https://www.odoo.com/documentation/20.0/applications/finance/fiscal_localizations/belgium.html)
uses broad company/Peppol wording. The [Belgian government applicability
guide](https://efactuur.belgium.be/nl/article/voor-wie-wordt-e-facturatie-verplicht)
describes establishment/transaction and sending/receiving exceptions and an
agreed EN16931-compliant alternative. The [English government
overview](https://einvoice.belgium.be/en/article/structured-electronic-invoices-between-companies-are-compulsory-2026)
also distinguishes private-customer sales from supplier inbound readiness.

**Decision:** do not encode “any VAT number always requires Peppol” or “PDF
email is enough.” Applicability must be explicit, source-linked and reviewed;
unknown cases fail clearly. Belgian law and applicable standards have priority;
guidance is not a substitute for underlying law or professional interpretation.
Exact current statutory text, mappings, retention and company applicability
remain professional-review gates, not invented facts.

The [official BIS Billing landing page](https://docs.peppol.eu/poacc/billing/3.0/)
displayed **May 2026 Release**. This verifies the page label, not a working
validator or the effective applicability of every rule. ODEE-014/016 must pin
actual artifacts/checksums/code lists and independently test them.

## D005 — Distinguish committed source, dirty work and implementation evidence

Baseline inspected: `4b7b21d709b9d13795f16910a0591810727340ad`. The
[application README](../../README.md), [model](../../internal/accounting/model.go),
[contacts](../../internal/accounting/contacts.go),
[authentication](../../internal/accounting/auth.go) and
[frontend scripts](../../web/package.json) confirm a foundation, not a rewrite
starting point. Source shows fixed accounts, integer quantities, line tax
rounding and ObjectID invoice references; README explicitly excludes several
statutory workflows. Those are evidenced gaps, not unsupported Odoo comparisons.

**Decision:** original workspace dirty changes remain user-owned and outside
the clean-HEAD baseline until ODEE-001 reconciliation. Do not reset/stash,
silently import/commit, or claim those changes passed here. This PM task ran
only documentation/JSON validation; application test evidence comes from QA.
No live Odoo page, real record, shared ODEE database or browser data was read.

## D006 — Separate planning specifications from execution state

**Decision:** [backlog.json](backlog.json) uses the agreed version-1 scheduler
shape. Initial ODEE-001..022 retain the exact approved dependencies, including
ODEE-019 requiring ODEE-022. Lower integer priority orders eligible leaves;
table position and ticket number do not establish readiness.

Full-suite parents have `kind: "epic"` and `status: "proposed"` and cannot be
dispatched. Parent links are not readiness edges. Future epics are staged
dependency scaffolding, not commitments to one enormous assignment. Split them
into independently reviewable vertical leaves, add the relevant conditional
dependencies and research current stable references before dispatch. C1–C7
enable real consumers when needed; they are not postponed to the end.

Live state is ignored `.odee/loop.json` (atomic JSON, no SQLite dependency),
owned by the coordinator. PM owns requirements/revision decisions, not worker
leases or verdict rows. Do not interpret absence of leaf `status` as either
implemented or approved. Documentation preparation alone cannot mark ODEE-020
or ODEE-021 merged before baseline and independent validation gates.

## D007 — Unprotected main is a real integration blocker

**Evidence:** coordinator reported main protection API returned 404 and
repository rulesets were empty on 2026-11-03. PM did not independently repeat
that remote inspection.

**Decision:** no protection bypass; prompts alone do not enforce server policy.
Development branches and reviewable PR work may continue. Unattended merging
to main requires human-approved required checks/protections and demonstrated
release permission boundaries. Existing release/deployment triggers must be
audited. Only the human releases, tags, publishes images, deploys or authorizes
production migration/side effects. Passing agent tests cannot lift this gate.

## D008 — Provider choice and deliberate differences

Odoo's [EDI guide](https://www.odoo.com/documentation/20.0/applications/finance/accounting/customer_invoices/electronic_invoicing.html#accounting-e-invoicing-peppol)
describes its own Access Point/SMP role. The [government
overview](https://einvoice.belgium.be/en/article/structured-electronic-invoices-between-companies-are-compulsory-2026)
directs software suppliers toward certified providers.

**Decision:** evaluate an existing certified Access Point, implement an original
mockable adapter and keep registration/spend/network activity explicitly gated.
Do not become an Access Point, sign up for Odoo services or assume Odoo's price
applies to ODEE. Incoming bills require review, never automatic post/payment;
accounting, payment and transport are different state machines. No exactly-once
network claim without durable intent, keys, deduplication and reconciliation.

## D009 — Real tester feedback repaired the existing browser-role contract

**Finding:** `qa-agent-contracts` (`8e0647e0…`), reported by the coordinator
2026-11-03. Independent QA returned **FAIL** because the browser-QA tool allowlist
omitted browser `readPage`, preventing the accepted read-only comparison and
browser-test role from inspecting the user-shared pages. The tester supplied
the reproducer [qa-contracts.test.mjs](../../tools/agents/qa-contracts.test.mjs).
This was a tool-contract failure, not evidence about live business records.

**Classification/PM decision:** existing-contract **integration defect** in the
ODEE-003/020 foundation, not a new feature or suite expansion. Keep the failing
assertion and existing browser/privacy acceptance; repair qualified tool-ID
validation and the affected role allowlists. No new product ticket, waived
criterion, real-record permission or artificial “capability complete” status.

**Repair and retest, coordinator-reported evidence:** parent added browser
`readPage`/`screenshotPage` to browser QA and read-only `readPage` to PM, and
updated validation for qualified IDs. Implementer rerun: **7/7 PASS**. Independent
config-QA retest: **7/7 PASS, zero skipped**, including documentation links; the
original failing browser assertion was unchanged.

**Evidence limitation:** tested candidate was baseline `4b7b21d…` **plus dirty
foundation changes**, not a content-addressed commit. This records a real
FAIL → repair → independent retest cycle, but cannot approve an exact committed
candidate or mark a dependent ticket merged. Coordinator must record the full
new commit SHA and renew affected verdicts before integration. Actual browser
capability and persistence drills remain separate from this config test.

## D010 — Select a safe next feature lane without importing dirty application work

**Decision:** after foundation baseline/QA gates, prioritize **ODEE-013**, one
docs-only certified Access Point comparison plus synthetic mocked-adapter
contract. Its allowed paths are `docs/`; application source is excluded from
this assignment. This is already approved in-scope work with only ODEE-001 as
an approved dependency, not an added product family or invented busywork.

The parent reports actual browser-persistence tooling is being developed; the
PM does not label it delivered or relax the isolation gate. Shared Odoo stays
read-only and shared ODEE `8098` receives no synthetic writes. A config PASS
alone is not browser persistence evidence.

ODEE-004/005/007 source edits must wait for original dirty-path reconciliation
and explicit leases. Never silently commit/include unrelated user changes.
ODEE-013 remains useful without provider credentials: document public evidence,
unknowns, status/idempotency/auth/inbound requirements and disabled behavior.
Human selection/spend/signup, sandbox authorization and production registration
are separate gates. The [EDI
reference](https://www.odoo.com/documentation/20.0/applications/finance/accounting/customer_invoices/electronic_invoicing.html#accounting-e-invoicing-peppol)
and [government provider
guidance](https://einvoice.belgium.be/en/article/structured-electronic-invoices-between-companies-are-compulsory-2026)
motivate the bounded comparison, not permission to use a live service.

## D011 — Confirmed isolation and CLI defects stay in the existing contract

**Feedback, 2026-11-03:** independent ODEE-002 tester
`06c8e396-b048-4d11-badc-bd1fb0287c11` reports implementation
`workspace.test.mjs` **10/10 PASS** on `4b7b21d…` plus dirty changes. Initial
fixture root-absence concerns were investigated; QA now reports that simulation
passes following a fixture update. Strict production roots remain mandatory;
portability changes are limited to fixtures or explicit CI setup.

**Confirmed independent finding, same candidate:** running
`node --test tools/agents/qa-workspace.test.mjs` produced **5 PASS, 2 FAIL**.
The [QA regressions](../../tools/agents/qa-workspace.test.mjs) remain unchanged
for the feature owner to repair against:

1. Creating environment B with `scratchRoot=A.originalsDir` succeeds, then
   `A.cleanup()` silently recursively removes B's owned scratch. This violates
   ODEE-002's explicit cross-worker cleanup/isolation invariant. Either reject
   nested allocation or refuse parent cleanup while a nested owned environment
   remains; do not make silent deletion an accepted behavior.
2. `node tools/agents/workspace.mjs constructor` exits zero with `{}`; inherited
   names such as `toString`/`valueOf` are also treated as commands. Use an
   own-property command allowlist and explicit nonzero unknown-command error.

**PM decision:** existing-contract integration/isolation defects, not new
features or scope expansion. Prioritize ownership-safe cleanup repair within
ODEE-002; preserve the implementation's 10/10 as limited evidence, not an
override of independent FAIL. Keep acceptance/revision unchanged, both
reproducers intact and the ticket blocked from acceptance until repair and
independent retest. No server-root relaxation, production deletion, new product
ticket or claim of a fixed result is authorized by this decision.

Coordinator owns repair dispatch/state. Require unchanged-reproducer retest
and exact committed candidate-SHA evidence before integration; the current
`4b7b21d…` plus dirty candidate is not a content-addressed approval.

**Feature-owner repair report, same date:** only `workspace.mjs` and
`workspace.test.mjs` were changed. Nested allocation is now rejected before
directory creation through ancestor ownership-marker checks; command dispatch
uses an own-property allowlist, rejecting `constructor`, `toString`, `valueOf`
and `__proto__`. Portable fixture capability creates fresh fake Git repositories;
production/CLI roots are unchanged. The owner also reports read-only Go-module
scratch cleanup hardening without following symlinks.

Implementer command
`node --test tools/agents/workspace.test.mjs tools/agents/qa-workspace.test.mjs`
reports **18/18 PASS** (11 implementation tests plus seven unchanged QA tests);
syntax checks also pass according to the owner. This is the **repair-owner
rerun**, not a new independent verdict. At that handoff, independent retest and
exact committed SHA remained outstanding; no verified/merged state or permission
to delete production data was inferred.

**Subsequent independent working-tree retest:** tester
`06c8e396-b048-4d11-badc-bd1fb0287c11` independently reran the same combined
command: **18/18 PASS, zero skips**. Nested-owner and inherited-command
regressions passed unchanged; root-absence emulation passed without modifying
actual `/home/vscode`. QA reports owned disposable leftovers cleaned and no
production changes/commits. This completes the reported same-ticket
FAIL → repair → independent working-tree retest cycle.

QA-supplied SHA-256 fingerprints:

```text
tools/agents/workspace.mjs
8e5e5fdbd263dea46920cb8adffe14b9c140ebecdb689eec42665f5570dddafb
tools/agents/workspace.test.mjs
31cfa41c089125b4bf8e138e0eff53a07f93f99ef5268155777bffcdc1560d76
tools/agents/qa-workspace.test.mjs
e2adec8a7549f474672fcd1022ca07339bbe65c85f7b3f57cb82193ec797f45f
```

**Remaining gate:** candidate is still
`4b7b21d709b9d13795f16910a0591810727340ad` **plus dirty changes**. Exact
integrated-SHA approval is **BLOCKED** pending the parent's committed snapshot
and affected-candidate retest. Fingerprints preserve provenance, not permission
to substitute working-tree PASS for exact committed-candidate approval.

**CI-fixture follow-up, independent local retest:** the same tester reports
**19/19 PASS, zero skips** (11 implementation plus eight QA) from the combined
command. The additional QA-only assertion requires the Ubuntu 24 workflow's
controlled `sudo install -d -o "$(id -u)" -g "$(id -g)"`
`/home/vscode/worktrees` preparation to precede Node tests, unconditionally and
without `continue-on-error`. Missing-root simulation remains covered. No local
privileged command ran and production-root constraints are unchanged.

Latest QA-supplied fingerprints for this follow-up:

```text
agents.yml workflow
9d9a8c3c11f05d2498d1085e3ba720ea9cdfbf1bd8df4041257cadbafa4cc874
tools/agents/qa-workspace.test.mjs
0450b3e87b41617787c8171f8cf08ed57780a14ea5f09cb99cced1f6505f3224
```

This is local regression evidence about workflow configuration, **not an
executed remote-CI PASS**. Ticket specification remains unchanged; candidate
is still `4b7b21d…` plus dirty changes and exact-SHA approval remains pending.

## D012 — A bounded shell slice is dispatched on a separate source baseline

**Coordinator-reported handoff, 2026-11-03:** baseline ODEE-001 QA is complete
according to the coordinator, who dispatched ODEE-004 to feature worker
`ab4b5722-4959-4cec-bc74-81d816838497` at
`/home/vscode/worktrees/odee-module-shell-25f10ffb`, based on committed
`4b7b21d709b9d13795f16910a0591810727340ad`. The bounded assignment is an
AppLauncher/module registry and authenticated API-client extraction, preserving
current behavior. It adds no modules or permission system.

**PM decision:** proceed within the existing ODEE-004 contract, not a new
feature or an implicit import of user-owned dirty changes. Coordinator reports
the original App diff is only two theme lines; the worker's separate branch
must preserve those original working changes at eventual integration rather
than overwrite them. Other original dirty paths remain outside this assignment.
This explicit separate baseline/lease addresses the source-overlap concern
behind D010; docs-only ODEE-013 remains a safe parallel research candidate.

**Status boundary:** this is a dispatch observation, not an execution-state
mutation or a feature-completion claim. The coordinator alone records
in-progress state. Independent QA and exact candidate-SHA evidence are still
pending; no verified, merged or released outcome is asserted here. A completed
subslice cannot mark the whole ODEE-004 contract accepted before its remaining
criteria and required QA gates are met.

## D013 — Preserve the direct-route gate and pin its previously ambiguous URL contract

**Material finding:** PM assigns stable ID
`F-004-DIRECT-ROUTE-20261103` to the coordinator-reported ODEE-004 integration
BLOCKED verdict. Non-root direct-route browser acceptance lacks evidence;
other reported browser/persistence and API/auth checks do not satisfy that
separate criterion. The coordinator identifies its candidate as `de3`; a full
SHA was not supplied or available in this PM worktree, so no exact-candidate
source/test verification is claimed here.

**Source assessment:** original `4b7b21d…` and inspected
`21c4c43bada687eb7fb94898fa6115c2dfe2e491` both initialize view state to
`apps` and navigate in memory. The extracted [registry](../../web/src/modules.ts)
names the existing active views; [App](../../web/src/App.tsx) does not initialize
from URL/history. [Go shell registration](../../cmd/odee/main.go) serves root and
assets, not non-root view paths. This is not evidence that extraction broke an
already-working URL router. Nevertheless, revision 1 explicitly requires
direct routes: its unspecified URL details are ambiguous, not permission to
delete or mark that valid criterion passed.

**PM decision:** ODEE-004 revision **2** pins a small registry-backed native
History API contract, with no router dependency or new business module:

- `/` is launcher; `/accounting` is Dashboard; existing accounting views use
  `/accounting/invoices`, `/accounting/bills`, `/accounting/journal`,
  `/accounting/accounts`, `/accounting/reports`; `/contacts` is Contacts.
- Direct GET/reload renders the requested view after authentication; no data
  leaks before authentication. Restore only a validated same-origin registered
  destination after sign-in; unsafe/external return destinations are rejected.
- Navigation updates URL/history from the registry; Back/Forward restores the
  view and closes transient state without writes or extra history entries.
- Unknown/planned UI paths show an explicit not-found view and launcher link,
  never enable a planned app. The chosen SPA shell may return HTTP 200; that
  is not module activation or API success. Reserved API/auth/assets/health
  namespaces preserve their existing non-SPA behavior.

This is the explicit ownership/UX decision within the approved shell scope.
Platform owns the shell/registry and minimal Go shell support, plus bounded
authentication-return changes only where needed. Revision 2 adds those Go/auth
paths to its lease; no permission-system implementation belongs in this repair.
All previous valid behavior/keyboard/session criteria remain.

**Priority/gates:** retain ODEE-004 priority 30 and dependency ODEE-001.
Its dependent ODEE-005 at priority 31 must not dispatch until revision-2
integration QA passes. Renew affected API/security/browser/integration verdicts
on the fresh candidate; never promote the existing BLOCKED verdict or reuse an
old-revision PASS. CAP-PLATFORM-DEEP-LINKS records an ODEE requirement/source gap,
not an invented Odoo capability or proof of application delivery.

**Candidate boundary:** these changes are prepared only in the separate
`odee-pm-qa-contracts-25f10ffb` next-candidate worktree based on available
`21c4c43…`. Frozen C and original dirty main are untouched. Parent integration
must preserve any intervening changes and bind a new exact SHA before QA.

## D014 — Repair ODEE-022 evidence/status gaps without changing its acceptance

**Material findings:** PM assigns IDs
`F-022-PLANNING-DRILL-20261103` (criterion 1: no executed linked/deduplicated
finding-plus-capability planning drill) and `F-022-STATUS-PIN-20261103`
(criterion 4: status omits persisted pinned Odoo/planning metadata).
The coordinator reports ODEE-022 BLOCKED and the loop owner confirms the
omissions. Source inspection corroborates the latter:
`tools/agents/loop.mjs` stores `state.backlog` but `summary()` does not return
its planning baseline. A generic schema-preservation test is not the missing
feedback drill.

**Classification/decision:** both are existing-contract integration/evidence
defects. ODEE-022 stays revision **1**, priority **13**, with unchanged
dependencies and all five acceptance criteria. The source owner repairs them;
PM does not edit tools or scheduler state. Reported 67 passing tests, and
unrelated production/browser checks, cannot mark these criteria satisfied.

**Concrete PM input for the real drill:** [backlog](backlog.json) now contains
three stable `planningChanges` records, linking these findings and D013, plus
one documented capability discovery:

1. `PM-20261103-004-ROUTES` links the real direct-route finding to
   CAP-PLATFORM-DEEP-LINKS and ODEE-004 revision 1 → 2.
2. `PM-20261103-CREDIT-PARTIAL` links discovery
   `G-CREDIT-PARTIAL-20261103` to existing CAP-CREDIT-LOCKS and ODEE-011
   revision 1 → 2. The already-verified [official Odoo 20.0 credit-note
   guide](https://www.odoo.com/documentation/20.0/applications/finance/accounting/customer_invoices/credit_notes.html)
   documents partial corrections. Do not invent a tester finding for this
   separately sourced discovery or create a duplicate credit-note ticket.
   The refinement adds one independent fixture: invoice 24200 cents, prior
   payment 10000, reviewed one-unit credit 12100, remaining receivable **2100**;
   retries cannot duplicate credit/allocation and no automatic cash refund or
   historical edit is implied. Belgian professional review remains required.
3. `PM-20261103-022-REPAIR` records the two unchanged-contract defects; it
   carries no ticket revision or fictitious successful verdict.

The [matrix](capabilities.json) links the corresponding capability deltas,
sources/discovery IDs, planned revisions and these decisions. Repeated reports
of the same issue must resolve to these IDs, not create another module ticket,
another copy of the change, or a revision bump without a substantive delta.

**Required executed drill, owned by coordinator/source owner and independent QA:**

- Use owned isolated fixture state, never the active scheduler or shared data.
  Bind the actual committed PM packet/specification and candidate SHA. Any
  fixture workers/verdicts/SHAs are explicitly synthetic rehearsal data, never
  evidence of delivered application features.
- Start from revision-1 contracts, then apply/reconcile the approved finding
  and capability deltas. Assert links resolve, ODEE-004/011 reach revision 2,
  incompatible in-flight claims pause with handoffs preserved, and affected
  candidate/gate/verdict eligibility is invalidated.
- Reapply the same packet: stable change/finding/discovery IDs, ticket counts
  and revisions remain unchanged. An ordinary repeated command-history record
  is permissible; a second planning change or duplicate feature ticket is not.
- Old-SHA/spec verdicts and a valid failing criterion cannot pass a new gate.
  Preserve stop-before-dispatch/merge behavior throughout replan/recovery.
- Restart/read `status`: expose persisted accepted `planningBaseline` (Odoo
  **20.0**, September 2026, 2026-11-03 retrieval, confidence and official
  sources), stable planning change/finding/capability links, ready/blocked
  leaves and next safe work. Do not show a new un-reconciled file pin as
  accepted state; report backlog divergence explicitly.
- Independent QA records actual commands, expected/actual results and exact
  candidate/revisions. Until run, these are required cases, not completed
  evidence. Source repair alone is not the drill or a QA PASS.

Priority remains dependency-driven: repair ODEE-022 at 13 and the ODEE-004
gate at 30 before ODEE-005 proceeds. ODEE-019 still requires ODEE-022. No
release, provider traffic, shared-browser writes or remote-CI success is
authorized or asserted.

## D015 — Version ODEE-005's bounded permission and financial-audit contract

**Input/authority:** the coordinator approved turning the earlier ODEE-005
preflight into a versioned contract candidate, not runtime activation.
Discovery `PREFLIGHT-005-IDENTITY-AUDIT-20261103` and planning change
`PM-20261103-005-PERMISSIONS` link ODEE-005 revision **1 → 2** to
CAP-COMPANY-CAPABILITIES and CAP-FINANCIAL-ACTOR-AUDIT. The new PM worktree is
based exactly on `6549b61137b155e941dea29975f77bd35b10a2c9`; only roadmap files
are changed. Existing ODEE-004/011 revision 2 and ODEE-022 revision 1,
dependencies and known unmet gates are preserved.

**Bounded outcome:** restrict the current company's existing HTTP/browser
workflows with explicit capabilities, and attribute successful posting/manual
payments atomically. No role-administration UI, invitation system, full IAM,
new business module or accounting formula is required. Platform retains
priority 31, dependency ODEE-004 and all existing valid QA criteria; add browser
QA and future implementation allowances for `README.md`/`.env.example`.
This contract preparation edits neither of those files nor runtime configuration.

### Principal, company membership and compatibility

| Existing authentication mode | Server-resolved principal | Attribution limitation |
| --- | --- | --- |
| GitHub | `github:<stable positive numeric user ID>` | Login name is display/provenance, never membership identity or BSON owner |
| Company token | `token:company` | Shared credential/service attribution, not proof which human acted |
| Explicit local development | `development:local` | Explicit dev-mode attribution only; existing loopback restrictions remain |

Preserve the current signed session, expiry, GitHub active-team-at-login,
bearer verification, origin/CSRF and content validation. A valid bearer or dev
flag cannot bypass configured GitHub authentication. Identity is not inferred
from request JSON, creator, payer, imported company or resource ownership.

Proposed configuration names are `ODEE_AUTHZ_MODE` and
`ODEE_CAPABILITY_GRANTS`; existing `ODEE_AUTH_MODE` still selects authentication.
The startup-loaded grant structure is an explicit array of principal,
company ObjectID and capability-set records. It contains no token/secret or
automatic role hierarchy. Validate IDs, known capability names and conflicting
duplicate grants; reject invalid configuration rather than guess.

- **Compatibility default:** preserve currently authenticated `read/write/post`
  business access when no explicit grant exists, with **no implicit admin**.
  Expose/document the mode; do not describe it as per-person financial isolation.
- **Explicit grant:** replaces fallback rights in either mode. A grant for
  another company does not grant current-company access or fall back into it;
  that authenticated principal is forbidden in this company.
- **Enforced mode:** enabled deliberately; an unmapped authenticated principal
  receives 403. Invalid/missing authentication remains 401. No first-login
  administrator, GitHub-team superuser or automatic owner grant exists.
- Session discovery reports current membership/capabilities without revealing
  other grants. A capability/membership 403 is an actionable forbidden state,
  not session expiry, implicit permission or a retry instruction. Preserve
  usable sign-in and existing logout with their original auth/CSRF protections.
- Resolve membership from server configuration, not stale client claims.
  A restart/reload policy for applying configuration is explicit; dynamic
  membership CRUD and external identity-provider integration are not required.

### Exact route/capability boundary

Capabilities imply **no other capability**:

| Operation | Required set |
| --- | --- |
| Current state/contact/import/original/preview reads | `read` |
| Draft create/edit; contact create/edit/archive/import; upload/scan/review-to-draft | `read`, `write` |
| Post existing draft; record manual payment | `read`, `post` |
| Proposed `GET /api/documents/{id}/audit` | `read`, `admin`, and target ownership |

Thus a poster need not edit drafts, an editor cannot post/pay, and an audit
administrator has no implicit financial mutation authority. Check direct API
requests before protected data/file work or external contact-import requests;
UI controls mirror, never replace, server enforcement. Existing public shell,
health and authentication/session discovery behavior is not accidentally gated
as business data. Tests cover every existing route, not just invoice buttons.

Keep BSON `organisationId`/`projectId` canonical precedence and per-axis valid
`ownerId` fallback at runtime without backfill. Actor strings are never cast
into ownership ObjectIDs. Wrong-scope resources remain inaccessible even to an
explicitly granted audit administrator.

### Financial-only durable audit

Record only `document.post` and `manual-payment.record` in this slice. An event
contains bounded server-generated event ID, UTC time, actor type/stable
principal, action, target ID/version and committed outcome. Include neither
raw request bodies nor tokens/hashes/secrets/CSRF/contact or OCR PII.

The financial mutation, version increment and event append are **one
owner/version-filtered document write**, preserving standalone MongoDB.
Never save the business change and then separately claim audit insertion made
them atomic. Rejected, stale, duplicate or definitively failed writes cannot
manufacture a successful event. For an uncertain result, preserve the
uncertainty and reconcile; a network failure proves neither "both absent" nor
exactly-once execution.

Events are API-append-only and absent from ordinary state/document JSON.
Admin retrieval is scoped and redacted. One posting plus the existing maximum
200 manual payments bounds the financial history to **201 events/document**;
do not silently trim or add an unbounded activity array. Preserve prior events
and equivalent memory-store semantics. A legacy document with no history is
valid: record only new successful actions, never invent historical people.

### Proposed audit expansion, visibly not covered

`PF-AUDIT-NONFINANCIAL-001` is one deduplicated **non-dispatchable proposed
follow-up**, not another executable ticket. It lives under existing
ODEE-W0-3, related to document controls ODEE-C1 and reliability/admin ODEE-C7.
It covers contact mutations/import, draft creation/edits, originals upload/scan
and cross-record review-to-draft links. Those workflows remain capability-gated
in ODEE-005 but are **not claimed as durable audit coverage**.

Before any later leaf dispatch, define bounded consumer-specific events,
retention/privacy/size requirements and explicit recovery/atomicity semantics.
GridFS and linked business-document writes cannot acquire standalone
cross-document atomicity by adding a separate audit collection. Choose a
reviewed intent/reconciliation or explicitly capability-gated transaction
design without breaking the existing original-file/review flow.

### QA and human rollout are different gates

Independent API/browser QA must challenge reader/editor/poster/audit-admin
sets, all three authentication modes, unmapped/wrong-company/invalid principals,
session expiry, authenticated 403 versus 401, CSRF/origin, direct-HTTP bypass,
UI affordances and canonical/legacy ownership. Use mock GitHub and isolated
synthetic servers, never shared Odoo/ODEE writes or real provider traffic.

Real disposable **standalone MongoDB** tests must prove mutation/event atomicity,
post/payment races, stale/duplicate requests, uncertain-result reconciliation,
prior event preservation, redaction and missing-history compatibility.
Required independent aliases are `qa-api-data`, `qa-integration`,
`qa-security`, `qa-browser`, bound to exact candidate/revision. No previous
valid criterion is waived or passing suite generalized beyond its coverage.

**Human decision before activation:** identify the initial admin principal(s),
approve explicit grants and authorize enforced rollout for a shared/live
deployment. No guessed admin, implicit team superuser or real grant/activation
is authorized here. This is **not a blocker to synthetic implementation and
testing** with explicit fake principals/grants.

Coordinator integrates this contract only after the ODEE-022 repair gate and
reconciles the authoritative ledger. ODEE-004 revision 2 then runs from an aligned
base; ODEE-005 implementation still waits for its dependency's valid gate.
PM does not update execution state or claim any implementation, remote-CI,
deployment, provider exchange or release success.

### Source basis, not an external IAM policy

The approved user/coordinator scope determines the permission defaults and
human boundary. Current [authentication](../../internal/accounting/auth.go),
[HTTP routes](../../internal/accounting/http.go),
[startup wiring](../../cmd/odee/main.go),
[financial bounds](../../internal/accounting/model.go) and
[scope/version filters](../../internal/accounting/store.go) establish the
compatibility constraints. [Review-to-draft](../../internal/accounting/import_http.go)
shows why broad cross-record audit is explicitly separate.

The [official MongoDB atomicity
manual](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)
(retrieved 2026-11-03 during preflight) establishes single-document atomicity
and expected-current-value filtering, not proof ODEE has implemented or tested
this design. Odoo's pinned stable 20.0 product references are unchanged; they
are not authority to grant ODEE users permissions.

## D016 — Follow up integration P's brittle planning-fixture assumptions

**Material finding:** `F-P-PLANNING-STALE-REVISION-20261103`, reported after
the ODEE-005 revision-2 proposal was integrated as exact P
`fbe01cf6e9e2db4b56a0d90f832ea006650b38f5`. Coordinator reports root checks
**70/71**, not green. The [D013/D014 planning
fixture](../../tools/agents/loop-planning.test.mjs) loads current roadmap files,
reconstructs the two target revision-1 contracts, then claims prerequisite
tickets using a helper default of revision 1. Its ODEE-005 prerequisite is
legitimately revision 2, so the claim correctly rejects `STALE_REVISION`.

**PM independently reproduced on exact P before editing the roadmap:**

```text
node --test --test-name-pattern='D013/D014 actual finding/capability packet' tools/agents/loop-planning.test.mjs
FAIL: STALE_REVISION: expected revision 2, received 1
dependent claim: tools/agents/loop-planning.test.mjs:138
0 PASS, 1 FAIL, 3 skipped by the explicit name selector
```

**Classification/decision:** a test-fixture portability/provenance defect, not
new business scope and not a production scheduler defect. Add only **ODEE-023
revision 1**, owner `coordinator` (designated source owner `b920…`), priority
**14**, depending on **ODEE-022**. Its sole implementation lease is
`tools/agents/loop-planning.test.mjs`; required independent roles are
`qa-api-data` and `qa-integration`. The stable planning change is
`PM-20261103-023-DRILL-PORTABILITY`.

Use the selected current fixture's actual dependent revisions/roles and derive
counts/readiness from the manifest and intended invariants. Exercise legitimate
ODEE-005 revision 2 plus later added/revised unrelated leaves, including role
changes. Keep real D013/D014 finding/capability/source links and all failure,
BLOCKED/no-waiver, invalidation, retained handoff/failure/lease, deduplication,
stop/resume and stale-gate rejection assertions. Do not repair by resetting
unrelated contracts, reverting ODEE-005, deleting tests or relaxing claim
validation.

The current-manifest rehearsal must be labelled honestly. It is not an exact
historical `6549b611…` or `21c4c43…` snapshot just because constants name those
commits. A true immutable historical test may load immutable content; a
reconstruction must describe its synthetic target variants and current input.
All fixture worker/SHA/merge records remain synthetic, not delivered features.

**Historical delivery versus new integration regression:** coordinator reports
ODEE-022 at W `184334d…` independently PASS for all three required roles and
locally integrated. Preserve that historical acceptance; ODEE-022 revision 1
is unchanged. The later exact-P regression needs its new narrow follow-up
before root checks can be declared green. No old PASS is retroactively revoked
or generalized to P, and no existing valid failure becomes PASS by relabelling.

**Additional scope warning:** source inspection found a separate fixed-69
schema assertion in [qa-loop.test.mjs](../../tools/agents/qa-loop.test.mjs).
Adding a legitimate 70th contract exposes that separate count assumption.
On the new docs-only candidate atop P, PM reproduced
`node --test --test-name-pattern='real backlog schema' tools/agents/qa-loop.test.mjs`:
**0 PASS, 1 FAIL, 12 skipped by selection**, `70 !== 69` at line 106.
This additional failure is from the new manifest, not a second claimed failure
in the historical exact-P 70/71 report.
It is **outside ODEE-023's sole path allowance** and is not quietly included in
this assignment. Coordinator must triage/lease any additional repair separately;
even a passing ODEE-023 focused test cannot prove all root checks green while
that assertion remains.

Only backlog/decision documents are changed in a new external PM worktree based
on exact P. No existing ticket contract, scheduler validation, fixture/source,
environment or authoritative execution state is changed. ODEE-013 docs-only
discovery may proceed concurrently because its docs lease does not overlap the
ODEE-023 test-file lease. No new dependency package, network/provider action,
permission activation, rollout, push or release is authorized.

## Material feedback packet

Use the following as a **template**, not a fabricated finding:

```text
Finding ID / related duplicate IDs:
Tested ticket ID + specification revision:
Candidate full SHA / environment / permitted integration mode:
Reproducer + commands + expected/actual + sanitized evidence:
Classification: defect | requirement-gap | ambiguous-requirement |
                usability-accessibility | integration-gap |
                documented-capability-gap | infrastructure-blocker
User impact / severity / independent source needed:
Official URL(s), version/edition, retrieval date, section and confidence:
Decision: repair | add | revise | split | defer | escalate
Reason and deduplication against existing tickets/capabilities:
Exact backlog delta: IDs, old/new revisions, acceptance and dependencies:
Affected ownership/path leases and milestone impact:
Required independent QA roles and verdicts invalidated:
Professional/provider/human decision and disabled behavior if applicable:
Coordinator action: validate graph, reconcile state, pause safely if incompatible
Dispatch recommendation and bounded next outcome:
Decision record ID / author-role / date:
```

Attach only synthetic/sanitized evidence. No customer PII, provider credentials,
private screenshots or proprietary source goes into this packet or public
search. Independent test evidence binds both full candidate SHA and revision.

## Source-linked PM decision examples

These are **illustrations**, not reports that the failures or state transitions
have occurred.

### Example A — Missing correction workflow is a requirement gap, not a waiver

QA on a future ODEE-011 candidate finds only full cancellation while the accepted
contract requires a partial credit note. The [20.0 credit-note
guide](https://www.odoo.com/documentation/20.0/applications/finance/accounting/customer_invoices/credit_notes.html)
provides a workflow reference, not Belgian legal certification.

- If partial credit is already in the current revision, classify as **defect**:
  repair that ticket; FAIL remains FAIL.
- If an independently justified edge case is missing, record a new revision or
  bounded follow-up, expected journal/remaining balance and original-invoice
  linkage. Link CAP-CREDIT-LOCKS; do not create a duplicate parent module.
- Coordinator safely pauses incompatible work, invalidates affected ledger,
  Peppol and API verdicts, and reruns them on the new SHA/revision.
- Prioritize the gap before cosmetic dashboards; never edit the old invoice to
  simulate a successful credit.

### Example B — Inbound readiness outranks a simplistic transport assumption

A tester reports that a B2C-only company's in-scope supplier receipt cannot be
reviewed because a UI blanket rule disabled Peppol. The [government English
guide](https://einvoice.belgium.be/en/article/structured-electronic-invoices-between-companies-are-compulsory-2026)
and [detailed applicability
guide](https://efactuur.belgium.be/nl/article/voor-wie-wordt-e-facturatie-verplicht)
support separating outward applicability from inward readiness.

PM deduplicates against ODEE-007/016, proposes an explicit reviewed applicability
case and draft-only receipt criterion, and escalates ambiguous legal
classification. Add exceptions and unknown states without making a real
participant registration or claiming every VAT number must send. QA validates
the synthetic case; provider unavailability remains BLOCKED, never PASS.

### Example C — Enterprise reporting is an in-scope gap, not a purchase order

A tester needs a reconciled period ledger but finds only the existing cumulative
trial balance. The [edition
comparison](https://www.odoo.com/page/editions) publicly lists Comprehensive
Accounting reporting in Enterprise; ODEE's [README](../../README.md) already
documents its report limitations.

PM links CAP-REPORTS and ODEE-017 rather than creating duplicate “full accounting”
work. Define one opening/activity/closing fixture and expected sums, then split
any larger reporting work. A request to purchase paid bank synchronization or
licensed services instead goes to the human; a documented product feature
cannot authorize spend, customer exports or live banking.

### Example D — A stable delta cannot rewrite an in-flight contract

If a later official stable release changes an applicable guide, record the
verified version/section and a capability delta using the
[documentation entry](https://www.odoo.com/documentation/) and release/support
evidence. Keep the existing 20.0 ticket pin until a reviewed revision is
necessary. If the new page is unreachable, mark the proposed claim unverified
and continue unrelated safe work; do not derive a version number from the date.

## Checkpoints and unresolved decisions

Invoke PM after material QA gaps, a product no-progress blocker, milestone
selection or relevant verified stable delta; ordinary repair/retest needs no
ceremonial replanning. After three unsuccessful repairs, preserve evidence,
block/split or escalate instead of redispatching unchanged work.

Foundation gates are ODEE-001 reconciliation and isolation/loop evidence,
accepted ODEE-020/021 contracts and the ODEE-022 feedback drill; consult the
coordinator's current state for which have been satisfied.
Docs-only ODEE-013 remains a safe research lane (D010). The coordinator has
separately dispatched the bounded ODEE-004 shell slice on its own baseline
(D012); current assignments and completion evidence belong to scheduler state.
Unresolved: main/release server enforcement; provider contract/authorization;
validator artifacts/effective versions; qualified accounting/legal acceptance.
The source/version research itself is no longer blocked by Odoo fetch failure:
direct public-page retrieval supplied the verified 20.0 baseline.

## Documentation validation evidence

PM ran dependency-free Node checks on 2026-11-03:

- Both JSON files parse and satisfy their declared shape.
- **23 leaves + 47 non-dispatchable epics**; ODEE-001..022 dependencies match the
  approved plan exactly, all references exist and the complete graph is acyclic.
- Owner/required-QA aliases resolve to the existing agent roster; **18 capability
  entries and 14 source entries** have valid ticket/source/baseline-path links.
- **29 local Markdown links** resolve; the two changed roadmap files pass whitespace checks.
- Importing `validateBacklog` from `tools/agents/loop.mjs` accepts all **70**
  contracts without creating or changing scheduler state.
- Existing `node --test tools/agents/qa-contracts.test.mjs` checks pass
  **2/2, zero skipped**; this is role/configuration regression evidence, not
  independent approval of the unimplemented ODEE-005 feature.
- The candidate has five unique linked planning-change records and one
  unchanged non-dispatchable proposed audit follow-up. Relative to exact P
  `fbe01cf6e9e2db4b56a0d90f832ea006650b38f5`, only ODEE-023 is added; all 69
  existing contracts are byte-for-byte unchanged, including ODEE-004/005/011
  revision 2 and ODEE-022 revision 1. Every approved dependency edge is preserved.
- The exact-P focused planning fixture failure is deliberately disclosed in
  D016, not waived or fixed by this documentation change. No all-root-green
  claim is made; the separately reproduced fixed-count assertion in the new
  docs-only candidate also requires explicit triage.

No application tests, provider exchange, release, state transition or feature
completion is asserted by these documentation checks. The proposal's roadmap
commit is for parent integration, not approval of runtime grants/activation.
Only the coordinator reconciles authoritative execution state.
