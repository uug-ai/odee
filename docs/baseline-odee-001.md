# ODEE-001 revision 1: clean baseline and reconciliation evidence

Recorded 2026-11-04. This is a bounded documentation candidate, **not acceptance
of ODEE-001, a release, or permission to start dependent features**.
The authoritative contract is [backlog ODEE-001 revision 1](roadmap/backlog.json).
The versioned backlog, decisions and capability claims are unchanged.

## Identity and control

| Item | Observed value |
| --- | --- |
| Repository | `https://github.com/uug-ai/odee` |
| Application base SHA | `21de316085ec877498300c9408c481553725da11` |
| Application candidate SHA | `21de316085ec877498300c9408c481553725da11` (no product changes) |
| Assigned branch | `cedricve-supreme-robot` |
| Isolated checkout | `/workspaces/odee/copilot-worktrees/odee/cedricve-supreme-robot` |
| Initial `git status --short` | Empty: no tracked modifications or untracked paths |
| `git rev-parse HEAD` and `git rev-parse refs/remotes/origin/main` | Both equal the application base |
| `git ls-remote origin refs/heads/main` | Same SHA, observed 2026-11-04 |
| Planning baseline | `4b7b21d709b9d13795f16910a0591810727340ad`, historical specification anchor, not this checkout |

The documentation candidate's distinct commit SHA is supplied in the independent
QA handoff. Tests below ran against the application SHA above; a documentation
commit does not retroactively change that test identity. Independent acceptance
must identify both the exact documentation candidate SHA and ticket revision 1.

The parent coordinator explicitly confirmed on 2026-11-04 that no shared
`.odee` ledger/root has been established for this execution. Its conversation is
the temporary single control authority, with no user STOP/PAUSE reported and
authorization limited to this gate. No private ledger was initialized, no
scheduler execution state was rewritten, and no downstream worker was dispatched.
Historical roadmap completion statements are not current execution state.

The host assigned this app-managed worktree rather than the operating guide's
`/home/vscode/worktrees` worker root. It is not the main checkout and was not
relocated or represented as a successful ODEE-002 workspace-isolation drill.
No project-memory interface is exposed among the available tools; no obsolete
local memory was consulted or recreated.

## User-owned dirty work: external, unverified provenance

The parent initially reported groups of modifications/untracked files in the
**original local checkout**, which was not copied into this cloud checkout.
It subsequently supplied a read-only path inventory observed on 2026-11-04:
17 modified tracked files (573 insertions, 186 deletions) and eight untracked
files. The exact inventory below is **attributed to that time-specific parent
observation**, not independently verified here. It is not a semantic comparison
or an attestation that the files remain unchanged. This session never accessed
the original checkout, its Git metadata, environment files or original storage.

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

All rows remain owned by the user until explicit reconciliation. No reset,
stash, checkout-overwrite, implicit commit, patch import, environment-file copy
or original-file migration was performed. A clean remote tree does not establish
equivalence to the original dirty workspace.

**Behavior differences remain unknown.** This checkout executes committed
`21de316` code, not the original workspace's pending startup/auth/API/extraction/
storage/UI/dependency changes. Some reported surfaces also have committed
implementations here; filename overlap is not proof that the pending changes
were included, omitted byte-for-byte, superseded or tested. No claim is made that
the original dirty behavior has been preserved by this source baseline.

The parent-reported inventory improves path/status provenance but does not close
semantic reconciliation. Before overlapping implementation, the coordinator must
obtain an owner-approved comparison against this exact application SHA and
explicit keep/integrate/defer decisions. Code, fixtures and runtime originals
need separate treatment. Secrets and real records stay outside evidence. Record
functional differences and their independent checks before accepting this as
the reconciled execution baseline. If the owner cannot establish that evidence,
keep this gate blocked; do not treat absence from the cloud checkout as
reconciliation.

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

## Ownership, protections and human-only triggers

| Surface | Ownership and boundary |
| --- | --- |
| This document | ODEE-001 coordinator; only this bounded documentation evidence is changed |
| Versioned roadmap/backlog/decisions/capabilities | PM product authority; read-only for this assignment |
| Scheduler/control state and file leases | Single parent coordinator; no private ledger or fabricated ticket completion |
| Backend/frontend/startup/configuration/fixtures | Existing user-owned work must first be reconciled, then a bounded feature lease assigned; this gate changes no product source |
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

**ODEE-001 acceptance is BLOCKED**, not PASS. Required independent role verdicts
must be bound to the committed documentation candidate and revision 1.
Unverified original-work reconciliation/behavior equivalence and inaccessible
server enforcement details remain explicit blockers; local MongoDB, scanner,
browser and persistence coverage is unavailable, not inferred green.

Only after coordinator acceptance of this gate could these direct successors
become dependency-ready, subject to current revisions, leases and control:

| Leaf | Revision | Priority | Remaining dispatch boundary |
| --- | --- | --- | --- |
| ODEE-002 | 1 | 10 | Worker isolation; overlaps ODEE-003 tool/docs leases, so do not assume simultaneous dispatch |
| ODEE-003 | 1 | 10 | Durable loop; overlaps ODEE-002 tool/docs leases |
| ODEE-020 | 1 | 11 | PM authority/feedback contract; docs leases must be reconciled |
| ODEE-013 | 2 | 25 | Docs-only provider comparison; no signup, transport, credentials or application changes |
| ODEE-004 | 3 | 30 | Source-changing shell/client slice; explicit original dirty-path reconciliation and independent role gates remain mandatory |

No successor is declared ready, dispatched, implemented or accepted here.
