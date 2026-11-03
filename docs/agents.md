# ODEE agent operating guide

## Team and authority

| Role | Owns | Does not own |
| --- | --- | --- |
| Project manager | Roadmap, Odoo capability gaps, feedback triage, ticket revisions and product priorities | QA approval, scheduler state, merges or releases |
| Coordinator/integrator | Ready queue, dependency/path leases, worker assignment, control state and verified integration | Waiving QA or expanding product/financial authority |
| Feature specialist | One bounded implementation and its focused tests | Its own independent acceptance verdict |
| Expert tester | Independent expected results, reproduction, tests and PASS/FAIL/BLOCKED evidence | Quietly changing production code or weakening acceptance |

Use the [roadmap and backlog](roadmap/README.md). The default capacity is three
feature workers and two testers. PM checkpoints are bounded planning jobs, not
an additional permanent implementation worker. Do not launch all named
specialists at once or nest uncontrolled agent trees.

The custom agent files under `.github/agents/` define the roles. Use the
coordinator to dispatch actual VS Code subagents; the local state CLI is a
scheduler/control ledger, **not an autonomous agent runtime**. When the current
host cannot invoke custom roles directly, pass the role file and this guide to
an available bounded worker. Report that fallback honestly.

Open the ODEE folder in the editor, or use `odee.code-workspace`, to make ODEE
the customization root. The monorepo's existing workspace also includes ODEE;
no global profile changes or neighboring project configuration are required.

## Local controls

Run these commands from the ODEE repository root. Read `--help` for assignment,
QA, reconciliation and recovery flags:

```sh
node tools/agents/loop.mjs --help
node tools/agents/loop.mjs init
node tools/agents/loop.mjs status
node tools/agents/loop.mjs next
node tools/agents/loop.mjs stop
```

`init` is one-time and refuses to reset an existing ledger. `next` only selects
advisory work: it does not reserve a ticket or launch an agent. The coordinator
must claim the ticket, invoke an actual worker and record the result. Resume
after a user stop is explicit:

```sh
node tools/agents/loop.mjs resume
```

The default ledger is ignored `.odee/loop.json`. All active workers must use
the same absolute `--root` when invoked from other worktrees. Do not initialize
an independent ledger in each worker tree. The dependency-free atomic JSON
ledger replaces the plan's illustrative SQLite path without adding a database
dependency; versioned ticket specifications remain separate from execution state.

On candidate submission, independently claim the required QA roles. Record
verdicts against the exact SHA and ticket revision. `gate` checks eligibility;
`merged` records a merge already performed by the coordinator. Neither command
executes Git or substitutes for required tests, repository protections or a
fresh control check immediately before integration.

`checkpoint`, `recover`, `requeue` and `recover-lock` preserve interrupted-work
history. Do not remove live locks, erase state, silently reassign interrupted
claims or reset failure counts to bypass the no-progress rule.

For isolated worktrees and synthetic environments:

```sh
node tools/agents/workspace.mjs --help
```

The workspace tool accepts only the expected ODEE Git parent, writes ownership
records in its Git metadata and refuses dirty/unmerged/foreign cleanup. It does
not copy ignored environment files. A port emitted by a completed CLI invocation
is no longer reserved; callers must handle an `EADDRINUSE` handoff failure.
Library callers can hold a real reservation until release/start. Keep test
scratch paths until children exit, then clean only the known owned data.

## Actual continuous development/testing

The coordinator repeats the following while the user has authorized work,
control is running, and safe dependency-ready tickets exist:

1. Read control/status and reconcile Git, ticket revisions and unfinished jobs.
2. Ask the PM for a planning decision only for material feedback, unclear
   requirements, a relevant Odoo delta, or a milestone boundary.
3. Claim a bounded ticket and assign its allowed files, worktree, baseline SHA,
   control root, acceptance criteria, tests and stop condition to a feature worker.
4. Receive a candidate commit and focused validation results.
5. Assign independent specialists to test that exact candidate and specification.
   Include real browser journeys for UI changes, not only unit tests.
6. Route ordinary defects back to the same owner with a reproducer. Send missing
   or ambiguous product requirements to the PM for a recorded revision.
7. Retest after repairs; invalidate verdicts when candidate/specification changes.
8. Recheck control and required verdicts before integration. Resolve/rebase changes
   on an integration candidate and renew affected evidence before merging through
   normal repository controls. Do not bypass branch protections.
9. Record delivered SHA, evidence, coverage/gaps and the next unlocked work.
   Continue to another ready ticket without asking for routine development approval.

After three unsuccessful repair rounds, block and triage that ticket instead of
repeating the same attempt. Continue unrelated safe work. If there is no
actionable work, checkpoint and wait; do not invent scope or rerun green tests
indefinitely.

VS Code must remain active and authorized. Sessions, permissions, quotas and
context limits can interrupt the loop. Persist state and resume explicitly;
neither prompt files nor a Node process can promise execution after VS Code
closes. Do not run a dummy polling daemon to simulate agent activity.

## Assignments and handoffs

Every worker receives:

- Ticket ID and specification revision; allowed outcome and excluded behavior.
- Current candidate/base SHA, branch, worktree and allowed path prefixes.
- Absolute shared coordinator control root, not an unrelated per-worker state.
- Synthetic data/database/ports, permitted integration mode and test selectors.
- Required tester roles, expected financial/state results and acceptance cases.
- A bounded stop condition and known blockers.

Every handoff identifies worker role, ticket/revision, candidate SHA, touched
files, commands/results, reproduction steps, unresolved limits and owned process
identifiers. Never put secrets, real customer data or unredacted private browser
captures into committed evidence.

Results arriving after stop may be checkpointed; they do not authorize a new
dispatch or merge. Cooperatively stop owned test processes without killing other
users' services or deleting unmerged work.

## Browser testing and Odoo comparison

- Shared Odoo is a read-only reference, not a disposable test database.
- Shared ODEE may use persistent/cloud data even on localhost. Read-only smoke
  inspection is allowed; create synthetic records only on the assigned isolated
  server and database.
- Compare workflow behavior, fields, states and error cases, not real customer
  values. Do not export records or copy screenshots containing private data into
  public repositories.
- Public official Odoo documentation establishes versioned capability references.
  Browser behavior supplements it but does not establish edition or legal rules.
- A UI ticket needs Playwright/assertion evidence against an isolated ODEE server.
  An HTTP 200, screenshot, or similar-looking layout alone is not acceptance.

## Project manager feedback contract

Classify feedback as defect, missing/ambiguous requirement, usability issue,
integration gap, Odoo capability gap or infrastructure blocker. Record evidence,
impact, decision, ticket revision, changed dependencies and invalidated verdicts.
Deduplicate related findings before creating work.

PM may add/revise/reprioritize features inside the agreed suite. Keep
accounting-first, Belgium/Peppol, English/Dutch and single-company-first priorities.
Major scope, financial commitments, regulatory policy and real external actions
still need human approval.

Pin the verified stable Odoo version/edition and official sources per ticket.
Include publicly documented Enterprise capabilities without promising full parity
or copying proprietary implementations. Do not infer the latest release from a
date or use `master` as a stable baseline. Document outages and unknowns honestly.
Belgian law and standards take precedence over Odoo behavior for compliance.

Never turn a failed valid criterion into a pass. A legitimate requirement
correction needs source evidence, a new revision and independent retesting.

## Testing and release boundaries

Use the repository's existing Go, frontend, MongoDB, OCR, OAuth and browser
commands. Start focused; run required integration checks on the final candidate.
Mark unavailable/skipped checks explicitly. Use actual disposable MongoDB for
persistence changes and independent expected totals for accounting changes.

The coordinator may integrate verified development commits. It must not create
release tags/GitHub Releases, publish release artifacts, deploy, initiate real
bank/Peppol/email actions, file taxes, sign paid contracts or migrate production.
Human release review receives exact-SHA evidence, known limitations, runtime/data
requirements, backup/restore results and rollback notes.

## Validation commands

The dependency-free operating-system contracts run from the repository root:

```sh
node --test tools/agents/*.test.mjs web/tests/test-environment.test.mjs
```

The existing frontend/browser prerequisites still apply. The authenticated,
disposable-MongoDB persistence rehearsal is separate from the demo suite:

```sh
cd web
npm run build
npm run test:e2e
node tests/persistence.mjs
```

The persistence runner owns its synthetic database and app process; it must
prove actual browser behavior before and after app restart, not mock state
responses or use the shared localhost application. CI runs both suites.

## Bootstrap evidence and limitations

The bootstrap integration branch starts at
`4b7b21d709b9d13795f16910a0591810727340ad`. Existing uncommitted changes in the
original workspace remain separate and must not be silently included in a
foundation commit.

Independent baseline QA passed Go race tests/vet and frontend tests (five),
build and formatting on both the original dirty workspace and the clean source
baseline. That initial baseline did not run browser/OCR/Mongo integration; record
those later results separately rather than backdating their coverage.

The initial remote audit found no protection on `main` and no repository
rulesets. Role instructions and local gates do not enforce GitHub permissions.
Audit branch protections, release permissions and deployment triggers before
treating unattended merging as server-enforced. Do not bypass whatever
protections are present at integration time.
