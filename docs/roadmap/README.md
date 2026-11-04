# ODEE execution roadmap

Planning baseline: **2026-11-03**, application HEAD
`4b7b21d709b9d13795f16910a0591810727340ad`. This roadmap is a specification,
not evidence that its tickets have been implemented, tested or released.
See [backlog](backlog.json), [capabilities and sources](capabilities.json),
[decisions and feedback contract](decisions.md) and [operating guide](../agents.md).

## D019 draft: future calculation lineage and operational correction boundaries

**Docs-only future-contract proposal, not finance acceptance or dispatch.**
[D019](decisions.md#d019--future-calculation-lineage-and-operational-lockcorrection-design)
appends requirements only to existing **ODEE-009 1 → 2** and **ODEE-011 2 → 3**.
All original criteria, owners, priorities, paths, dependencies and QA remain.
The graph stays **70 contracts / 23 leaves / 47 epics** with the same genuinely
overlapping serialized accounting/web leases. ODEE-010/012 need no change.

Evidence anchor `04562c9e72e513abacf0c90d868f80414b141c3c` is the recovered
**UNACCEPTED PR9 finance draft**, not delivery. It includes accepted-local
company baseline `051747e8defe83632888bddd21105a4b78eb2e99`; that is not proof
PR5 merged remotely. Coordinator reports actual protected remote main
`e5c501256f191682b46ea37fd4121021eba946e2` after PR3/4. Earlier main/protection,
local-integration and validation statements below are dated planning history,
not the current remote state. PR8/5/6/9 remain unmerged; six finance acceptance
roles remain pending final-main reconciliation despite reported green CI.

ODEE-009 binds reproducible calculation-policy identity independently of chart
configuration and requires reviewed exact scales/discount/rounding/bounds design
before code. Optional explicit version-checked draft conversion is not a new
mandatory feature; recognized legacy drafts remain usable without it. Preserve
the old per-line oracle: net **2**, VAT **2**, total **4 cents**; payment **1**
leaves **3**, through historical verification/payment after policy/chart changes.

ODEE-011 requires a bounded **pre-code operational-lock/correction design**:
date/scope/capability rules, original snapshots/account meanings, observed-lock
revision, concurrency boundary, bounded audit and uncertain-state recovery.
Immutable period flags/default activation are not close/reopen authority.
Retain **24200 − 10000 − 12100 = 2100 cents**, with no automatic refund or
bank movement. No atomic-lock, cross-document transaction, instantaneous
revocation or statutory guarantee is invented.

Only CAP-EXACT-AMOUNTS/CAP-CREDIT-LOCKS planning fields advance; baseline,
public-source dates and delivery/QA claims are unchanged. Existing D014 history
and partial-credit acceptance remain intact. D018, ODEE-006 revision 1,
ODEE-007 revision 2 and active ODEE-008 revision 2 remain unchanged. Odoo stays
**20.0 / retrieved 2026-11-03**; no fresh recrawl or latest-version claim.
Coordinator review, protected final-main/dependency reconciliation and separate
tester-gated PRs precede implementation/acceptance; this packet changes no
canonical ledger, claims, grants or live system.

Draft validation: actual graph/deep-preservation checks pass; selected root
documentation/coordinator tests are **48 PASS / 2 FAIL / zero skipped**.
Both failures are historical D013/D014 fixture assumptions that the current
credit capability still points to D014. **Root is not green**; see D019's
validation record. No fixture repair or application acceptance is included.

## 2026-11-04 checkpoint: future ODEE-007/008 revision 2

[D018](decisions.md#d018--future-company-snapshots-and-immutable-finance-configuration)
versions only existing ODEE-007/008 from 1 to 2 on accepted application
`d65d0558c6fbf679fd3f1c7887397d8a8a177cff`. Initial evidence was
`b17e7222bccfd7bd4b151cfb3d1572796bd62d2a`; accounting backend rules are
byte-unchanged, and current translated UI source was rechecked.
The original planning and verified Odoo **20.0 / 2026-11-03** baselines remain.

Both future tickets depend on ODEE-005 **and ODEE-006**, preserve every original
criterion and path, and retain priorities 40/41. ODEE-007 pins server-resolved
contact/version snapshots, explicit draft refresh/manual conversion and
own-company capture at creation when configured, without fabricating missing
history or blocking existing manual flows. ODEE-008 pins immutable published
versions, observed draft bindings, default activation rather than revocation,
original-binding historical payments, and standalone same-document financial
snapshot/state/version/audit atomicity. It adds browser/localization QA to its
original four roles. A bounded publication/crash-recovery design is required
before its implementation; no cross-record atomicity is promised.

**Serialization is unchanged:** shared model/store/HTTP/App/type edits genuinely
overlap. No fake 007→008 dependency, lease narrowing, framework, split or new
feature is added. Settings reads require `read`, settings mutation/publication/
activation `read+admin`, contact/draft changes `read+write`, and financial actions
`read+post`; capabilities imply nothing else. Live grants/activation and
statutory use remain human/professional gates.

The coordinator reports ODEE-006 revision 1 locally integrated/ledger merged at
d65 after fresh independent QA; its prior failure and history remain. Existing
005 isolation and 006 invalid-money repairs are ordinary resolved defects, not
duplicate features. This PM packet changes no execution state, delivered/QA
capability claims or application code. Coordinator review, integration and
reconciliation precede dispatch. Earlier checkpoint sections below are planning
history, not a substitute for current coordinator state.

## Material QA checkpoint: next candidate only

The coordinator reports ODEE-004 blocked on missing non-root direct-route
evidence and ODEE-022 blocked on its linked planning drill and persisted-pin
status output. These are not waived by other passing suites.
Decisions D013/D014 retain all valid gates: ODEE-004 revision 2 pins explicit
registry-backed URLs/history/unknown-route behavior; ODEE-022 keeps revision 1
and requires source repair plus the actual drill. A documented partial-credit
gap refines existing ODEE-011 to revision 2, not a duplicate feature ticket.
The linked planning changes are inputs for that drill, not proof it ran.
ODEE-005 waits for the ODEE-004 gate. This PM delta lives in a separate
next-candidate worktree; frozen C and original dirty main are unchanged.

## ODEE-005 revision-2 contract candidate, not activation

Decision D015 pins stable GitHub numeric principals, shared token/dev attribution,
explicit company grants and server/UI `read/write/post/admin` checks.
Compatibility defaults preserve existing read/write/post access without implicit
admin; explicitly enabled enforced mode forbids unmapped authenticated users
without treating 403 as logout. Actor identity never becomes BSON ownership.
Only posting/manual-payment events gain the proposed same-document atomic
audit, with admin-gated redacted retrieval and the existing 201-event bound.
Broader contact/draft/original/review audit remains visibly proposed as
`PF-AUDIT-NONFINANCIAL-001` under existing epics, not delivered coverage.

Human approval of initial admin/grants and enforced live rollout is required
**before activation**, not before synthetic implementation/QA. Coordinator
integrates the proposal after ODEE-022 repair, preserves the ODEE-004 revision-2
gate, and alone reconciles execution state. No current grant/configuration,
source, runtime or deployment is changed by this roadmap candidate.

## Product direction

Build an independent integrated business suite, extending Go/React/MongoDB.
First deliver accounting/invoicing and contacts for **one legal company,
Belgium, Peppol sending AND receiving, English and Dutch**. Keep finance the
authoritative ledger. Preserve existing APIs, posted history, original files,
exact monetary values and runtime legacy-owner compatibility. Valid stable
`ownerId` fills missing BSON ObjectID `organisationId`/`projectId` axes without
a migration; existing nonempty canonical axes always win. Actor, imported
company and payer identifiers are not ownership.

The committed foundation already contains drafts, posting/manual payments,
contacts, authentication and bill scanning. Source inspection is not a new
test run or an Odoo-parity claim. The original workspace also has user-owned
dirty work; it is **not** silently part of this clean-HEAD baseline. ODEE-001
must preserve/reconcile that work before overlapping implementation.

## Execution order and ownership

Lower numeric priority wins only among dependency-ready, leased leaf tickets.
The exact approved dependency graph is in the backlog, including
**ODEE-019 → ODEE-022**. Initial assignments are bounded slices, not entire
modules. If a slice cannot fit one reviewable outcome, PM adds a revision and
smaller tickets before dispatch; the coordinator never quietly expands it.

| Wave | Approved parent epics | Accountable owner |
| --- | --- | --- |
| 0: safe development | W0.1 baseline; W0.2 agent loop; W0.3 access/shell; W0.4 EN/NL; W0.5 isolated QA; W0.6 adaptive PM | Coordinator, Platform, PM; independent QA |
| 1: accounting milestone | F1 company/contacts; F2 ledger/configuration; F3 invoice/correction/locks; F4 PDFs/aging/dunning; F5 banking/expenses; F6 Belgian tax/close; F7 Peppol outbound; F8 Peppol inbound; F9 operational readiness | Contacts/Catalog, Finance, Belgian/Peppol, Platform |
| 2: revenue/customer | R1 catalog; R2 CRM; R3 sales; R4 subscriptions; R5 rental; R6 helpdesk/repairs; R7 POS | Contacts/Catalog, Sales, Services, Supply |
| 3: supply/production | S1 purchasing; S2 stock/barcode; S3 valuation/replenishment; M1 manufacturing; M2 quality/maintenance/PLM | Supply, Manufacturing, Finance |
| 4: services | P1 projects/tasks; P2 time/planning; P3 billing/profitability; P4 field service/appointments | Services, Finance |
| 5: people | H1 employees/private HR; H2 recruitment; H3 attendance/leave/appraisals; H4 payroll integration; H5 fleet/workplace | People, Belgian/Peppol, Collaboration |
| 6: commerce/engagement | E1 website/portal; E2 ecommerce; E3 marketing/surveys; E4 events/learning/appointments | Commerce, Engagement, Services |
| Enabling, not last | C1 documents/knowledge; C2 activities/calendar/discuss; C3 approvals/signatures; C4 reports/dashboards; C5 APIs/imports/jobs; C6 controlled customization; C7 reliability/admin | Engagement, Data, Platform, Finance |

These parent epics are **non-dispatchable** (`kind: "epic"`,
`status: "proposed"`). Their acceptance describes eventual decomposition/exit,
not authorization to assign a whole suite to one worker. Later epics must be
split into source-researched, bounded leaf contracts at their planning checkpoint.

**Initial dependency-driven sequence:** reconcile ODEE-001 baseline and required checks; then
ODEE-002 isolation, ODEE-003 durable loop and ODEE-020 PM contract can progress
on disjoint surfaces. ODEE-021 verifies the reference matrix; ODEE-022 proves
feedback/revision integration. Platform extraction/access and contacts/finance
then unlock invoice and Peppol slices. Provider research ODEE-013 need not wait
for UI work. No ticket is declared merged by this roadmap.

**Safe parallel research lane after foundation:** ODEE-013's **docs-only** provider
comparison and synthetic adapter-contract examples. It has no application-source
lease and avoids the original dirty accounting/auth/contact hotspots. No provider
signup, credentials, registration or transport is authorized. Source-changing
ODEE-004/005/007 work waits for explicit dirty-path reconciliation and leases.

[Peppol provider discovery](peppol-provider-contract.md)

For dated coordinator-reported dispatches, see the decision log; live
in-progress state belongs only to the coordinator, not this planning document.

## Product authority versus execution authority

- **PM asks “what next, and why?”** Owns these four planning files, evidence-based
  capability gaps, deduplicated feedback, priorities, revisions and in-scope
  additions/splits/deferrals. PM cannot approve its own implementation, waive
  failed criteria, mutate scheduler execution state, merge or release.
- **Coordinator asks “what can execute safely now?”** Sole scheduler-state and
  merge authority; validates graph/revision changes, dependencies, leases,
  candidate SHA and required independent verdicts. It dispatches accepted PM
  contracts but cannot replace product policy or bypass QA.
- **Feature workers build; testers challenge.** Start with at most three feature
  workers and two testers. Select domain experts as needed, sequentially for
  additional high-risk gates. Named roles are a roster, not simultaneous agents.
- Reviewed requirements live here. Live assignments, controls, attempts,
  verdicts and leases live in ignored `.odee/loop.json`, with the coordinator as
  single writer. Epic `status` is planning metadata, not execution state.
  State uses JSON rather than requiring SQLite. Session chat/todos alone are
  not durable execution records.

## QA and integration gates

1. A contract has concrete acceptance, owner, revision, dependency IDs, allowed
   paths, synthetic integration mode and required QA aliases (`odee-<alias>`).
2. Feature evidence names exact SHA/revision, commands/results and unavailable
   prerequisites. Testers independently return PASS/FAIL/BLOCKED; missing
   required evidence is not PASS. Tests must not import production arithmetic
   as the sole oracle.
3. API/data checks cover permissions, BSON ownership fallback, stale writes,
   races/retries and history. Persistence changes use disposable MongoDB;
   UI changes add isolated browser journeys and EN/NL/accessibility checks.
4. Finance/Peppol adds independent ledger/tax fixtures, concurrent posting and
   uncertain-result recovery, version-pinned conformance validation, raw
   originals and separate accounting/payment/transport states.
5. Candidate/spec changes invalidate affected verdicts. Integration retests the
   fresh merged candidate. After three failed repair rounds, block and triage;
   continue unrelated ready work rather than retrying indefinitely.
6. Observe stop before dispatch and merge; preserve in-flight work. Explicit
   resume reconciles revisions/Git/assignments. VS Code must remain active and
   authorized: these artifacts are not an unattended daemon.

Use existing focused Go, Vitest, MongoDB/scanner and Playwright checks.
ODEE-001 records what actually runs at its candidate; this document does not
assert that every command in the session plan exists at HEAD.

## Odoo reference and legal precedence

**Verified stable reference: Odoo 20.0 (September 2026), high confidence.**
On 2026-11-03, official documentation redirected to `/documentation/20.0/`,
the support table listed 20.0 released September 2026, and the 20 release notes
confirmed that month. Both Community and public Enterprise are considered:
the official comparison marks Invoicing in both and Comprehensive Accounting
in Enterprise; the versioned EDI guide explicitly includes Community Peppol
registration. This does not mean every localization/report is in both editions.

The matrix records exact URLs, edition caveats, retrieval method and unknowns.
`web_fetch` failed for Odoo; public-page `curl` retrieval succeeded after web
search. Search suggestions alone were not accepted as proof. Do not use
`master`, guess the next annual version, copy Odoo code/assets or claim complete
Enterprise parity. Review relevant stable deltas at milestones and material QA
findings, not by continuously recrawling the catalog.

Belgian legislation/official government guidance and applicable standards take
precedence over simplified Odoo wording. Government applicability includes
exceptions and an agreed EN16931-compliant alternative; do not model “every
VAT number must always use Peppol.” Qualified legal/accountant review is still
required for statutory mappings, sequence policy and release suitability.

## Human boundaries, exclusions and current blockers

- Human controls releases/tags/images/deployment, production migrations/cutover,
  destructive data changes, provider signup/spend, participant registration,
  live Peppol/email/customer communications, transfers and filings. Mock/offline
  development continues; sandbox transport needs explicit authorization.
- Main is currently **unprotected**, according to the coordinator's repository
  inspection. Prompt policy is not server enforcement. Development branches
  and reviewable PR work may continue; unattended merging to main remains
  blocked until required checks/protections and human-controlled release
  permissions are demonstrably enforced.
- Access Point selection, credentials/contract and professional signoff are
  unresolved. Do not claim successful provider exchange or statutory readiness.
- The BIS Billing page identifies **May 2026 Release**; exact validator
  artifacts/checksums and applicability must be pinned in ODEE-014 before a
  conformance PASS, not assumed from the mutable landing URL.
- Neither shared Odoo nor persistent shared ODEE `8098` is a synthetic test
  environment. No live records were accessed for this roadmap. Read-only UI
  comparison, if later authorized/needed, supplements public docs only; never
  export PII or use browser appearance to establish version/edition.
- One company first; full multi-company/consolidation/SaaS tenancy, home-grown
  payroll calculation, qualified-signature certification, IoT/VoIP hardware,
  industry-specific apps, arbitrary spreadsheet/code/low-code execution and
  automatic migration are not authorized first-release work. Major expansion,
  cost, regulatory policy and architecture/ownership changes go to the human.
- Memory MCP discovery exposed no project-memory interface. No obsolete local
  memory was read or created. When writable memory is available, publish the
  verified baseline to `odee/overview` and focused `accounting`, `testing` and
  `agent-workflow` topics; these files remain roadmap specifications, not a
  substitute local memory database.
