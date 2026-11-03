# ODEE execution roadmap

Planning baseline: **2026-11-03**, application HEAD
`4b7b21d709b9d13795f16910a0591810727340ad`. This roadmap is a specification,
not evidence that its tickets have been implemented, tested or released.
See [backlog](backlog.json), [capabilities and sources](capabilities.json),
[decisions and feedback contract](decisions.md) and [operating guide](../agents.md).

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
