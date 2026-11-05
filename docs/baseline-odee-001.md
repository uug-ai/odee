# ODEE-001 revision 1: clean baseline and reconciliation evidence

Historical evidence recorded 2026-11-04; a separate current-main reconciliation
was added 2026-11-05. The historical observations below are not retroactively
refreshed.
This is a bounded documentation candidate, **not acceptance of ODEE-001, a
release, or permission to start dependent features**.
The authoritative contract is [backlog ODEE-001 revision 1](roadmap/backlog.json).
The versioned backlog, decisions and capability claims are unchanged.

## Current-main reconciliation (2026-11-05)

This section adds a current snapshot without replacing the historical
application baseline recorded below.

| Item | Observed value |
| --- | --- |
| Current remote `main` and worktree base | `f12c10b2bd586a3808a6f8eabeb9dffa7e446ac5`, observed in the worktree and `origin/main` on 2026-11-05 |
| Historical application source baseline | `21de316085ec877498300c9408c481553725da11`; preserved as historical evidence, not current main |
| Documentation candidate reviewed before this correction | `eb8e673e832ecb1c068bf2b5c077277721b0195c`, parent `f12c10b2bd586a3808a6f8eabeb9dffa7e446ac5`; this follow-up correction has its own commit SHA |
| Worktree at assignment start | `cedricve-automatic-adventure`, based on `f12c10b`; clean before the document-only change |

### Behavior added since the historical source baseline

A read-only GitHub comparison of `21de316` to `f12c10b` shows the calculation
policy implementation and related UI/tests were added after the historical
baseline. Current source evidence includes:

- Backend support for an explicit `exact-fixed-v1` calculation policy for new
  drafts, with EUR and exponent 2 metadata and persisted calculation inputs and
  results (`internal/accounting/calculation_policy.go`,
  `internal/accounting/calculation_policy_document.go`, `internal/accounting/store.go`).
- Invoice/bill editing UI with an explicit opt-in for new drafts and policy
  identity/history presentation (`web/src/App.tsx`, `web/src/types.ts`).
- Historical safeguards: posted documents are immutable; legacy documents are
  not implicitly converted; unsupported or unresolved calculation history is
  rejected rather than silently recalculated or treated as valid. The UI also
  disables edit/post/payment actions for unresolved policy history
  (`internal/accounting/calculation_policy_document.go`,
  `internal/accounting/configuration_finance.go`, `web/src/App.tsx`).

These are observed current-main behavior differences, not a financial-policy
acceptance verdict or evidence that all related tests passed.

### Current-main checks and protection evidence

Independent reports identified five required CI contexts on the parent
application baseline. The read-only `gh api` check-runs query for exact SHA
`f12c10b2bd586a3808a6f8eabeb9dffa7e446ac5` confirms completed/success for all
five reported contexts: `server`, `web`, `agents`,
`security-scan (arm64, ubuntu-24.04-arm)`, and
`security-scan (amd64, ubuntu-24.04)`. These inherited parent checks do not
show that CI ran on documentation candidate
`eb8e673e832ecb1c068bf2b5c077277721b0195c`. Fresh checks on that exact candidate
and required independent QA remain necessary before ODEE-001 acceptance. The
token-visible check list does not establish which contexts are configured as
required.

The branch summary reports `main` as protected at `f12c10b`. The detailed branch
protection endpoint returned HTTP 403 (`Resource not accessible by
integration`); the repository rulesets query returned an empty list. Required
status-check configuration, review requirements, admin/bypass enforcement,
force-push/deletion restrictions, and organization-level controls therefore
remain unverified. Successful checks alone do not prove enforceable protection.

### Test, ledger, and ownership limitations

No test suite was run for this documentation change. Independent QA-worker
reports state Go, npm, MongoDB, and Chromium were unavailable in those workers;
no local test pass is claimed. In this documentation worker, Go and npm
executables are present, while MongoDB executables and a `chromium` executable
are absent; those presence probes are not test results.

The coordinator reports that the user designated the parent Project as the
temporary app-managed authority, operating-guide amendment PR #16 was merged
at `940b2174d7e83f9903e8d9ff05a355bc6cf52b2a`, and the parent Project recorded
`RUNNING` status. On that reported basis, app-managed fallback adoption is in
effect: the parent session is the single writer for current assignments,
ownership, control, and handoffs. This worker cannot independently verify
current parent status or its full active-assignment inventory, and cannot use a
Project/session identity as a filesystem ledger. There is no `.odee` directory
or `.odee/loop.json` in this worker, and no replacement ledger was created.
That local absence does not establish whether any historical root exists
elsewhere. No new dirty-path inventory is inferred; the original dirty-work
and classification evidence below remains historical.

## Historical identity and control (recorded 2026-11-04)

| Item | Observed value |
| --- | --- |
| Repository | `https://github.com/uug-ai/odee` |
| Application base SHA | `21de316085ec877498300c9408c481553725da11` |
| Application source baseline | `main` at `21de316085ec877498300c9408c481553725da11` |
| Separate clean user-work candidate | `feature/accounting` at `378008e07ed8352f373c8b9485c057b72f617fdb` (parent-reported clean; PR #15 open, not merged) |
| ODEE-001 documentation candidate | PR #14, initially `20fa4d0505dbac8c7106c5dac5974e9836761e70`; any later evidence edit requires new exact-SHA QA |
| Assigned branch | `cedricve-supreme-robot` |
| Isolated checkout | `/workspaces/odee/copilot-worktrees/odee/cedricve-supreme-robot` |
| Initial `git status --short` | Empty: no tracked modifications or untracked paths |
| `git rev-parse HEAD` and `git rev-parse refs/remotes/origin/main` | Both equal the application base |
| `git ls-remote origin refs/heads/main` | Same SHA, observed 2026-11-04 |
| Planning baseline | `4b7b21d709b9d13795f16910a0591810727340ad`, historical specification anchor, not this checkout |

Tests in the initial evidence table ran against the application SHA above; a
documentation commit does not retroactively change that test identity. PR #14's
checks and QA are separate evidence and must identify the exact current
documentation candidate SHA and ticket revision 1.

The initial fresh-checkout probe found no `.odee/loop.json`; this is **not**
evidence that the project has no canonical control ledger. Merged PR #13 records
that the coordinator previously read and validated an existing version-1
canonical ledger against the same root, verified its unchanged SHA-256, and did
not initialize a second ledger. `tools/agents/loop.mjs` supports an explicit
`--root DIR`, and [the operating guide](agents.md) requires all workers to pass
the same absolute root. Its local process lock is host/PID-bound: use this
approach only when all sessions can access the same trusted local filesystem;
do not assume a shared/NFS path is safe across hosts. The exact previously
adopted root was not available to this PM session. The coordinator must recover
that root and run read-only `status` there; if sessions run on different hosts,
a supported shared coordinator service is needed before ledger-controlled
dispatch. No private ledger was initialized or execution state fabricated here.

### Control recovery and adoption proposal (draft; inactive)

No exact root path was found in the available PR #3, #4, #5 or #13 evidence, and
the prior coordinator reports that a bounded session-history search did not
recover it. This is a recovery gap, not evidence that the earlier ledger or its
accepted work never existed. Do not initialize a replacement ledger in this
worktree or another worker checkout.

1. **Recover read-only first.** The coordinator asks the prior root owner for the
   exact absolute path and host. On that host, verify the real path and
   repository identity, then run
   `node tools/agents/loop.mjs --root /absolute/path/to/recovered/root status`
   without `init`, `resume`, or state-writing commands. Capture only sanitized
   status, schema/backlog identity and file digest. If the root is inaccessible,
   on an untrusted/shared filesystem, or has an ambiguous live lock, stop; do
   not copy, delete or reconstruct it.
2. **Preserve historical evidence as evidence, not synthetic state.** Keep each
   merged PR's actual tested candidate SHA, independent verdicts, required CI
   results and merge SHA linked to that PR. For example, PR #3 records
   independent API/data and integration PASS plus five CI checks on
   `5b15b2dcbe57bd0fa4d10c2bd699419c9dd74b8a`, followed by its actual merge at
   `416a4e5d1beb4ccb6116b31745bbdf1ed5a314b9`. Do not invent past claims,
   acceptance events or a reconstructed ledger chronology. A missing ledger
   cannot erase valid merged evidence or automatically accept a different
   ticket revision/candidate.
3. **Proposed fallback if recovery fails.** The following is the proposed
   `docs/agents.md` amendment; it is not active until reviewed and adopted:

   > **App-managed session execution (recovery fallback; explicit adoption
   > required).** If the previously adopted shared control root is unavailable,
   > do not initialize another worker or coordinator ledger. After a PM-reviewed
   > amendment and an explicit coordinator handoff, one persistent parent
   > coordinator session may act as the temporary authority for current
   > assignments, ownership, stop/pause and handoffs only. Every assignment
   > records the ticket/revision, exact base SHA, allowed paths, isolated branch
   > and worktree, child session ID, dependencies, required independent QA
   > roles and stop condition. The coordinator checks open PRs and active
   > sessions before assigning paths; because this mode has no atomic file
   > leases, overlapping path assignments are forbidden. Workers report
   > candidate SHAs and evidence to the parent and do not infer other workers'
   > states. Existing merged PRs remain historical evidence at their actual
   > tested and merged SHAs; no missing ledger events or ticket statuses are
   > reconstructed. Ticket acceptance still requires its specified independent
   > roles at the exact candidate/specification, required CI, and a normal
   > protected merge. If the parent session, ownership, stop state or candidate
   > cannot be verified, pause new claims and integration. Existing worker and
   > tester caps remain in force.

   In this mode, the parent coordinator session would be the single authority
   for current assignments, not a second persistent ticket ledger. It would
   record each handoff and candidate SHA; workers do not create ledgers or
   infer each other's status. The mode cannot replace exact-SHA independent QA,
   CI or normal protected merge.
4. **Reconcile before assigning overlapping work.** Query live app-managed
   project sessions and open PRs for active owners and path overlap. Preserve
   interrupted or uncommitted work with its current owner; do not copy it into
   another branch. If ownership, candidate SHA or a required verdict cannot be
   established, mark that assignment blocked and leave its files untouched.
5. **Require explicit adoption.** The fallback is only a proposal until the
   PM-reviewed guide amendment is merged through normal repository controls
   and the coordinator records the chosen authority in the parent session.
   Until then, this document authorizes neither a replacement ledger nor new
   downstream claims, integration, or product activation.

The separate `CONFIG-SAVE-REPAIR` r1 author work is not part of this ODEE-001
candidate. Preserve its uncommitted source and tests in the owner's isolated
worktree; do not cherry-pick, commit or edit them here. Once that owner supplies
an exact candidate SHA, independent QA must use the repair contract's declared
roles (including browser verification for the configuration-save behavior) and
report PASS/FAIL/BLOCKED against that SHA. No author verdict or uncommitted
working-tree result substitutes for those roles.

The host assigned this app-managed worktree rather than the operating guide's
`/home/vscode/worktrees` worker root. It is not the main checkout and was not
relocated or represented as a successful ODEE-002 workspace-isolation drill.
No project-memory interface is exposed among the available tools; no obsolete
local memory was consulted or recreated.

## User-owned work: historical dirty inventory and current clean branch

The parent initially reported modifications/untracked files in the **original
local checkout**, which was not copied into this cloud checkout. It supplied a
read-only, time-specific path inventory observed on 2026-11-04:
17 modified tracked files (573 insertions, 186 deletions) and eight untracked
files. The exact inventory below is **attributed to that historical parent
observation**, not a current dirty-state report. The coordinator later reported
that the original checkout is clean on `feature/accounting` at `378008e`, pushed
to `origin/feature/accounting`; PR [#15](https://github.com/uug-ai/odee/pull/15)
remains open and unmerged. This session did not access the original checkout,
its Git metadata, environment files or original storage.

| Parent-reported modified tracked paths | Classification and reconciliation boundary |
| --- | --- |
| `.env.example` | User-owned configuration-template change; review without copying credentials or local environment files |
| `README.md` | User-owned documentation change |
| `cmd/odee/main.go` | User-owned server startup/configuration change; platform ownership overlaps |
| `internal/accounting/auth.go`, `internal/accounting/auth_test.go` | User-owned authentication behavior and tests; platform ownership overlaps |
| `internal/accounting/extract.go` | User-owned scanner/extraction behavior |
| `internal/accounting/http.go`, `internal/accounting/http_test.go`, `internal/accounting/import_store.go` | User-owned HTTP/import persistence behavior and tests; platform, finance and data ownership overlaps |
| `web/index.html`, `web/package.json` | User-owned entry/build/dependency changes |
| `web/src/App.tsx`, `web/src/main.tsx`, `web/src/styles.css` | User-owned UI/bootstrap/styles; platform and domain UI ownership overlaps |
| `web/tests/fixtures.mjs`, `web/tests/imports.spec.ts`, `web/tests/mongo.mjs` | User-owned scanner/import/persistence fixtures and verification |

| Parent-reported untracked paths | Classification and reconciliation boundary |
| --- | --- |
| `internal/accounting/auth_browser_test.go` | User-owned authentication browser fixture |
| `internal/accounting/extract_test.go` | User-owned extraction verification |
| `internal/accounting/import_filesystem_mongo_test.go`, `internal/accounting/originals_disk.go`, `internal/accounting/originals_disk_test.go` | User-owned original-file storage source and tests; not authorization to copy runtime originals |
| `web/src/ThemeToggle.tsx` | User-owned theme UI |
| `web/tests/oauth.mjs`, `web/tests/theme.spec.ts` | User-owned OAuth/theme verification |

No reset, stash, checkout-overwrite, environment-file copy or original-file
migration was performed by this session. The parent reports that the historical
work is now committed and the original checkout clean; the preserved branch is
separately reviewable, not yet integrated into `main`.

### Behavior differences identified against the committed main baseline

The parent-reported branch head was fetched read-only from `origin` and compared
with `origin/main` at `21de316`. The branch's net diff is 15 files. The original
workspace itself was not read, so this is a comparison of the two commits, not a
byte-for-byte comparison with the historical dirty snapshot.

The exact net-diff paths are `.env.example`, `README.md`,
`internal/accounting/auth.go`, `internal/accounting/auth_browser_test.go`,
`internal/accounting/auth_test.go`, `internal/accounting/http.go`,
`web/index.html`, `web/package.json`, `web/src/App.tsx`,
`web/src/ThemeToggle.tsx`, `web/src/main.tsx`, `web/src/styles.css`,
`web/tests/imports.spec.ts`, `web/tests/oauth.mjs`, and
`web/tests/theme.spec.ts`.

| Net difference on `feature/accounting` | Classification |
| --- | --- |
| `.env.example` and README: prefer `127.0.0.1`, revise local persistent-workspace instructions, OAuth callback guidance and test command documentation | Configuration/documentation behavior; review separately from product baseline |
| `internal/accounting/auth.go` and tests: redirect an OAuth login request whose Host differs from configured `ODEE_ORIGIN` to that canonical origin before issuing state; expose the authorization endpoint for controlled testing | Authentication/OAuth host behavior |
| `web/src/ThemeToggle.tsx`, `App.tsx`, `main.tsx`, `index.html` and styles: initialize from saved/system preference; toggle and persist light/dark choice locally; synchronize tabs; update theme color | User-visible theme behavior |
| OAuth browser test, theme browser tests, and import test changes | Verification changes; not independently accepted by this note |
| `web/package.json` | Adds the explicit `test:oauth` command; no dependency addition is reported in the branch diff |

The historical scanner/extraction and original-file paths in the dirty inventory
are **not net changes** in the current `origin/main...origin/feature/accounting`
diff; they match the current main tree at this comparison. This does not prove
the old working-copy bytes or behavior were identical. The clean branch therefore
preserves the reported work without making its unmerged theme/auth/UI changes
part of the `main` execution baseline. The baseline source remains `21de316`
until PRs land through normal review. Path provenance is now reconciled to a
clean, committed branch; acceptance of its behavior remains the separate PR
review and test gate.

At the observed `378008e` head, PR #15's server and web checks failed; agent and
both security-scan checks passed. The coordinator assigned a separate developer
to repair the existing configuration browser failure on that branch. This PM
session does not modify its source or tests. Neither that branch nor its failed
checks are claimed as accepted implementation.

## Reproducible checks and actual outcomes

All check results here are author observations, not independent QA verdicts.
No live database URI, provider credential, `.env`, or `.env.local` was loaded.
Go and frontend checks used the repository's allowlisted
`safeTestEnvironment({ NODE_ENV: 'test' })` helper, which creates dedicated
synthetic home, cache, temporary, company and database-name paths. No shared
application at port 8098 was used. Builds were not launched as application
services. Native tool/browser probes used that same isolated environment.

Observed toolchain: Go **1.27.3**, Node **26.12.1**, npm **11.20.0**, Linux amd64.
`go.mod` declares **1.26.10** and CI selects that file; frontend CI selects
**Node 22**. These local runs do not establish parity with the CI toolchains.

The exact command wrapper used this existing helper with `spawnSync`; each
command's working directory and environment override are recorded below:

```js
import { spawnSync } from 'node:child_process'
import { safeTestEnvironment } from './tools/agents/workspace.mjs'
const env = safeTestEnvironment({ NODE_ENV: 'test' })
// Invoke each command below with { env, cwd: the recorded directory }.
// Only the production frontend build overrides NODE_ENV to 'production'.
```

| Directory | Exact check command | Result | Evidence/limitation |
| --- | --- | --- | --- |
| Repository root | `test -z "$(gofmt -l cmd internal)"` | PASS | Exit 0; read-only formatting check |
| Repository root | `go vet ./...` | PASS | Exit 0 |
| Repository root | `go test -race -json ./...` | PASS with BLOCKED coverage | Exit 0; 2,428 passing test/subtest events, 30 skipped events; skipped cases below are not PASS |
| Repository root | `go build -o "$ODEE_TEST_SCRATCH_DIR/odee" ./cmd/odee` | PASS | Exit 0; output confined to owned synthetic scratch |
| `web` | `npm run build` (initial prerequisite probe) | BLOCKED | Exit 127, `tsc: not found`; dependencies initially absent |
| `web` | `npm ci --ignore-scripts --no-audit --no-fund` | BLOCKED | Exit 1, `SELF_SIGNED_CERT_IN_CHAIN` fetching a committed-lockfile dependency |
| `web` | `NODE_OPTIONS=--use-system-ca npm ci --ignore-scripts --no-audit --no-fund` | PASS | Exit 0; 154 packages restored using OS CA trust; TLS verification was not disabled and manifests/lockfile were not changed |
| Repository root | `NODE_ENV=test node --test tools/agents/*.test.mjs web/tests/test-environment.test.mjs` | PASS with unavailable lifecycle branch | Exit 0; 99 passed, zero failed/skipped; production fixture root unavailable, so CLI lifecycle branch returned after proving safe refusal, not successful real-root creation |
| `web` | `NODE_ENV=production npm run build` | PASS | Exit 0; TypeScript check and Vite production bundle |
| `web` | `NODE_ENV=test npm test` | PASS | Exit 0; 129 tests in nine files |
| `web` | `NODE_ENV=test npm run format:check` | PASS | Exit 0; no formatting changes made |
| `web` | `NODE_ENV=test npm run test:mongo` | BLOCKED | Exit 1 before tests: MongoDB 8.0.16 download failed with `getaddrinfo EAI_AGAIN fastdl.mongodb.org`; no disposable daemon became available |
| `web` | `NODE_ENV=test npm run test:scans` | BLOCKED, not run | Isolated Chromium executable absent; `pdfinfo`, `pdftotext`, `pdftoppm`, `tesseract` absent |
| `web` | `NODE_ENV=test npm run test:e2e` | BLOCKED, not run | Isolated Chromium executable absent; no isolated browser journey claimed |
| `web` | `NODE_ENV=test node tests/persistence.mjs` | BLOCKED, not run | Requires disposable MongoDB and Chromium; neither available |
| Repository root | Container builds/native scanner/image vulnerability checks from `.github/workflows/security-scan.yml` | BLOCKED locally, not run | No local container/image verification performed; remote base checks are reported separately below |

The 30 skipped race-suite events are in `internal/accounting`: financial audit
atomicity; canonical/legacy authorization; opt-in capabilities browser fixture;
configuration lifecycle/publication uncertainty/financial uncertainty/durable
reassertion/scope; contacts persistence; paid-PDF and general PDF/image scanner
fixtures; volume/GridFS ownership and disk restart; upload review/duplicates;
document persistence/atomicity; and Mongo-backed snapshot/review/company-profile
cases. Specifically, the seven `TestCompanyProfileLegacyScopeAndConflicts/true`
subcases are `missing`, `null`, `zero`, `organisation-only`, `project-only`,
`foreign-organisation`, and `foreign-project`. Other skipped snapshot cases
are `TestReviewRetryRejectsForeignCanonicalDocument/true`,
`TestSnapshotLifecycleMongo`, `TestReviewDraftCapturesCompanyAndPartner/true`,
`TestSnapshotCanonicalAndLegacyScope/true`, and
`TestSnapshotReadVersionNotCrossDocumentLock/true`.
Unavailable fixture/URI/OCR/browser prerequisites explain these skips; a passing
Go process is not MongoDB, OCR, browser, restart or cross-scope acceptance.

### Remote base CI, not this documentation candidate's CI

Read-only query:

```sh
gh api repos/uug-ai/odee/commits/21de316085ec877498300c9408c481553725da11/check-runs \
  --jq '[.check_runs[]|{name,status,conclusion,head_sha}]'
```

It returned completed/success for `server`, `web`, `agents`,
`security-scan (arm64, ubuntu-24.04-arm)` and
`security-scan (amd64, ubuntu-24.04)`, each at the exact application SHA.
These remote conclusions do not turn local skipped checks green, independently
accept this ticket, or establish that a new documentation commit has passed CI.
The matching base runs were
[Check Odee](https://github.com/uug-ai/odee/actions/runs/41858122647),
[Check agent workflow](https://github.com/uug-ai/odee/actions/runs/41858122519)
and [Security scan](https://github.com/uug-ai/odee/actions/runs/41858122051).

### Independent preliminary base review

The assigned independent tester reported its own clean checkout at the exact
application SHA, 99 passing agent/environment contracts, passing Go formatting,
`go vet ./...`, `go test -race ./...` and `go build -o /dev/null ./cmd/odee`.
It reported frontend/MongoDB/OCR/browser/persistence checks BLOCKED/not run in
its environment, which lacked dependencies/fixtures, and the same protection
detail endpoint's HTTP 403. Its Go toolchain was also 1.27.3. Those are
independently reported base observations, **not final exact-documentation-SHA
verdicts** for either required role. The author's frontend passes above must not
be attributed to the tester. Final `qa-api-data` and `qa-integration` verdicts
must separately name the committed documentation candidate and revision 1.

### Pull request runs on the prior documentation candidate

PR [#14](https://github.com/uug-ai/odee/pull/14) was opened draft at
`20fa4d0505dbac8c7106c5dac5974e9836761e70` against `21de316`. Its exact-head
checks were:

| Check on `20fa4d0` | Result |
| --- | --- |
| `server` | PASS |
| `agents` | PASS |
| `security-scan (amd64, ubuntu-24.04)` | PASS |
| `security-scan (arm64, ubuntu-24.04-arm)` | PASS |
| `web` | FAIL in `npm run test:e2e`; `web/tests/configuration.mjs --browser-only` could not find expected text `Configuratieconcept opgeslagen.`; the subsequent persistence step did not run |

The failing run is
[Check Odee](https://github.com/uug-ai/odee/actions/runs/41868995035), web job
126710585500. A separate developer was assigned to investigate this existing
configuration-browser failure; this PM assignment does not change those source
or test files. Any edit to this evidence document creates a new PR head and
requires fresh exact-head checks and both required independent QA roles. The old
results above are not transferable.

At the later reported `feature/accounting` head `378008e`, PR #15 likewise had
server and web failures, with agents and both security scans passing. Those
failures belong to that separate, still-open source candidate; they are not a
repair or a new ticket claim here.

## Ownership, protections and human-only triggers

| Surface | Ownership and boundary |
| --- | --- |
| This document | ODEE-001 coordinator; only this bounded documentation evidence is changed |
| Versioned roadmap/backlog/decisions/capabilities | PM product authority; read-only for this assignment |
| Scheduler/control state and file leases | Single parent coordinator; no private ledger or fabricated ticket completion |
| Backend/frontend/startup/configuration/fixtures | Historical dirty work is reported committed on the separate `feature/accounting` branch; do not overwrite it. New work needs a reconciled source base and nonoverlapping lease; this gate changes no product source |
| Independent verdicts | `qa-api-data` and `qa-integration`; author cannot accept its own evidence |
| Main integration | Coordinator only after exact-head QA, required remote checks, reconciled changes and verified enforceable server controls |
| Releases, artifacts, deployment, production migration and live business actions | Human only; neither this evidence nor green CI authorizes them |

Current read-only control observations, 2026-11-04:

| Exact command | Result | Meaning |
| --- | --- | --- |
| `gh api repos/uug-ai/odee/branches/main --jq '{name,protected,sha:.commit.sha}'` | PASS: `protected: true`, SHA `21de316085ec877498300c9408c481553725da11` | Branch summary, not proof of required checks/reviews or bypass restrictions |
| `gh api repos/uug-ai/odee/branches/main/protection --jq '{required_status_checks,enforce_admins,required_pull_request_reviews,restrictions,required_linear_history,allow_force_pushes,allow_deletions,required_conversation_resolution,lock_branch}'` | BLOCKED: HTTP 403, `Resource not accessible by integration` | Detailed enforcement cannot be verified with this token |
| `gh api repos/uug-ai/odee/rulesets --jq '[.[] | {id,name,enforcement,target}]'` | PASS: `[]` | No repository rulesets returned; this does not negate classic branch protection or prove org-level controls |
| `gh api repos/uug-ai/odee/actions/permissions --jq '{enabled,allowed_actions}'` | BLOCKED: HTTP 403, `Resource not accessible by integration` | Actions/release permission policy unverified |
| `gh api repos/uug-ai/odee/environments --jq '[.environments[]|{name,protection_rules,deployment_branch_policy}]'` | PASS: `[]` | No repository environments returned; not evidence of human approval enforcement elsewhere |

Older roadmap statements that main was unprotected are dated history, not this
observation. Conversely, `protected: true` cannot establish the exact required
check names, review count, administrator/bypass constraints, force-push/deletion
policy or release permissions. **Unattended main merges remain blocked until an
authorized operator verifies those enforceable controls.** Do not remove
protection or bypass it to resolve an evidence-access failure.

Reviewed workflow triggers at the application SHA:

| Workflow | Trigger and side effects |
| --- | --- |
| `.github/workflows/check.yml` | Main push and pull request: Go formatting/vet/race/build; frontend build/unit, scanner, MongoDB, browser and persistence checks |
| `.github/workflows/agents.yml` | Main push and pull request: existing agent/environment contract tests; CI prepares the controlled fixture root |
| `.github/workflows/security-scan.yml` | PR opened/synchronize/reopened, main push, manual dispatch and reusable call: native amd64/arm64 image builds or explicitly supplied Odee image pull, isolated demo smoke and Trivy; HIGH/CRITICAL block the check |
| `.github/workflows/release-create.yml` | **GitHub release created**: shared mutable `uug-ai/workflows/.github/workflows/release-create.yml@main`, inherited secrets, package write, multiarchitecture image publication, then security verification; `create_gitops_pr: false` is not proof of no external deployment side effects |

No workflow was edited or triggered manually, no branch was pushed by this gate,
and no PR, tag, release, merge, deployment, image publication or real-data action
was created. Inspect the currently resolved shared release workflow and actual
server permissions with an authorized human before release; its body and
deployment-side controls were not audited here.

## Gate outcome and conditional successors

**ODEE-001 acceptance is BLOCKED**, not PASS. The historical dirty-path list is
no longer a current dirty-work blocker: the parent reports a clean, committed
user-work branch, and this note compares its net source diff with main and
identifies observable behavior differences. That branch remains unmerged and
its acceptance is separate. PR #14's prior exact-head web check failed;
candidate-bound `qa-api-data`/`qa-integration` verdicts and fresh checks after
the evidence update are required. Detailed protection/release-control settings
remain inaccessible (HTTP 403). Local MongoDB/OCR/browser/persistence gaps are
recorded; remote CI results do not retroactively erase them.

Only after coordinator acceptance of this gate could these direct successors
become dependency-ready, subject to current revisions, leases and control:

| Leaf | Revision | Priority | Remaining dispatch boundary |
| --- | --- | --- | --- |
| ODEE-002 | 1 | 10 | Worker isolation; overlaps ODEE-003 tool/docs leases, so do not assume simultaneous dispatch |
| ODEE-003 | 1 | 10 | Durable loop; overlaps ODEE-002 tool/docs leases |
| ODEE-020 | 1 | 11 | PM authority/feedback contract; docs leases must be reconciled |
| ODEE-013 | 2 | 25 | Docs-only provider comparison; no signup, transport, credentials or application changes |
| ODEE-004 | 3 | 30 | Source-changing shell/client slice overlaps open PR #15 (`web/src/`, `web/tests/`, auth); first reconcile that candidate and lease the exact net paths |

No successor is declared ready, dispatched, implemented or accepted here.
