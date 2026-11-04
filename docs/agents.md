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

Both `status` and explicit `resume` return the **accepted, persisted**
`planningBaseline` and `planningChanges`, including the pinned reference version,
retrieval date/confidence, source URLs and stable PM finding/discovery/capability
links. They do not infer a newer Odoo release or silently accept a changed
roadmap file. `backlogChanged`/`backlogError` expose divergence; reconcile the
reviewed packet before resume or another claim. Older ledgers without planning
metadata report `null`/`[]`, not a fabricated baseline.

`leaves.counts` reports execution states without epics or retired tickets.
`leaves.ready` lists currently claimable **feature** leaves; `leaves.blocked`
lists queued feature blockers (control, dependency, lease, capacity, failure or
checkpoint). Raw `ready` state alone does not mean dependencies or leases permit
dispatch. `next` remains advisory feature selection, not an assignment; use
`next --kind qa` for the QA lane. Resume preserves unfinished claims and never
launches tools, clears failures or turns roadmap/capability labels into QA PASS.

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

## Slack progress reporting

The coordinator publishes progress to the user's designated Slack channel
using the configured Slack app. PM, feature and tester handoffs remain the input;
individual workers do not receive Slack credentials or post independently.
Slack is a reporting surface, not the execution ledger or an approval mechanism.
Explicitly authorized coordinator-managed messages have been delivered. This
does not mean automation, unattended sending or acceptance is installed or
proven. `tools/agents/slack.mjs` is an explicit, bounded coordinator command and
library; it does not subscribe to the ledger or run a daemon.

### Configuration and activation

- Configure the destination with `ODEE_SLACK_CHANNEL_ID` in the coordinator's
  run configuration, and `ODEE_SLACK_BOT_TOKEN` through a secret manager or
  protected runtime secret. Do not hardcode a channel or credential in source.
- Revoke and replace any token shared in chat before persistent reporter
  activation. Never copy
  tokens into Git, PRs, roadmap files, handoffs, logs, screenshots or messages,
  and do not request replacement credentials in chat.
- Invite the bot to the designated channel and grant only the needed
  `chat:write` permission. Do not add broad channel-history or admin scopes
  merely to send updates.
- Keep credentials out of feature/tester environments and synthetic test
  fixtures. Bounded coordinator sends require explicit authorization. Implement
  and validate an automated reporter separately before enabling it; manual
  delivery does not prove that automation exists. The command is not wired into
  scheduler mutations, agent jobs or workflows.

### Intermediate updates, milestones and message contract

Post meaningful state changes, not every command or test assertion:

- Between milestones, report observed findings, a concise decision rationale,
  the current action and the next step. Explain why a repair, retest or
  dependency takes priority without dumping agent transcripts or speculation.
- When a gate remains pending, state what is being awaited and what will happen
  after PASS, FAIL or BLOCKED. Do not imply progress or completion without evidence.
- Feature assignment or a coherent candidate PR ready for independent testing.
- Tester FAIL/BLOCKED findings, the repair plan and a repaired candidate entering
  retest; retain the earlier failure rather than replacing it with a green retry.
- QA results with completed/required role counts, outstanding checks and gaps.
  Partial PASS, green CI, local integration and actual GitHub merge are distinct.
- A verified protected-main merge, its real merge SHA and the next unlocked work.
- Material PM scope/specification changes, dependency blockers and checkpoints
  when the loop pauses, stops or has no actionable work.

Use one parent message per feature PR and threaded progress updates where
possible. Include the ticket/revision, concise outcome, exact candidate or merge
SHA, PR link, role/CI status, limitations and next action. Publish only sanitized
summaries: no source dumps, private evidence, credentials, personal/business
records, real invoice data or private browser captures.

### Bounded command and structured input

Only the authorized coordinator runs `send`. Always pass the **same canonical
shared control root** used by the loop; do not initialize another ledger. Use
one stable receipt root for the coordinator, not one per worker or invocation.
Both roots must be absolute real directories without symlink aliases. Receipt
and event paths remain confined to the receipt root; no credentials/config file
is read. Supply the two environment variables above through the protected
coordinator environment, never command-line arguments.

```sh
node tools/agents/slack.mjs --help
node tools/agents/slack.mjs status --root "$PWD" --control-root "$ODEE_CONTROL_ROOT"
node tools/agents/slack.mjs send --root "$PWD" --control-root "$ODEE_CONTROL_ROOT" \
  --event .local-data/slack-event.json
```

The event file is a small JSON object, not a transcript or arbitrary Slack body.
Example with entirely synthetic provenance:

```json
{
  "repo": "synthetic/fixture",
  "ticket": "ODEESLACK-002",
  "revision": 1,
  "sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "pr": 12,
  "event": "progress",
  "updateId": "ci-pending",
  "outcome": "in-progress",
  "role": "api",
  "qa": { "passed": 1, "required": 2, "status": "partial" },
  "ci": "pending",
  "findings": "One independent role is still pending.",
  "decision": "Keep the gate pending until the exact head is tested.",
  "currentAction": "Assigning the remaining role.",
  "nextSteps": "On PASS inspect CI; on FAIL repair and retest.",
  "limitations": "Feature author tests are not independent acceptance."
}
```

- Required: lowercase `owner/repo`, ticket ID, positive integer `revision`, full
  lowercase 40/64-character `sha`, `event`, `outcome`, `qa` and `ci`.
  Optional: positive integer `pr`, safe lowercase role identifier, stable
  `updateId` and the five summary fields shown above. A PR URL is constructed,
  never supplied.
- `updateId` identifies a distinct observation/decision on the **same**
  SHA/revision/event/role. Use 1–48 lowercase ASCII letters, digits or hyphens,
  beginning with a letter; credential patterns, markup and unsafe identifiers
  are rejected. Keep it unchanged on retries of that observation. For example,
  after the `ci-pending` update above, a later event may use `updateId: "ci-pass"`
  and `ci: "pass"` with revised findings/decision/next steps while independent
  QA remains `1/2` and `partial`. Both updates use the same PR thread. New facts
  need their own stable identifier, not a random identifier on each invocation.
- Events: `progress`, `candidate`, `qa`, `repair`, `integration`, `merge`,
  `checkpoint`. Outcomes: `in-progress`, `ready-for-qa`, `pass`, `fail`, `blocked`,
  `local-integration`, `merged`, `paused`, `stopped`. Only `merge` may report
  `merged`; only `integration` may report `local-integration`. A `pass` outcome
  requires a `qa` event and role; every `qa` event requires a role.
- QA has integer `passed`/`required` counts (at most 100 roles) and overall status
  `pending`, `partial`, `pass`, `fail` or `blocked`. Overall PASS requires all
  nonzero required roles; partial PASS remains explicitly partial. A `qa` event
  with a failing/blocked role cannot claim overall PASS or that every required
  role passed. A passing role may still accompany overall FAIL/BLOCKED when
  other roles fail or block.
  CI is `not-run`, `pending`, `pass`, `fail`, `blocked` or `unavailable`, and means
  supplied **remote** CI status, not feature-author local test results.
- Summaries are optional single-line ASCII prose, at most 220 characters each.
  Unknown fields, mentions, markup, links, multiline dumps and recognizable
  credential patterns are rejected, not silently redacted. Do not paste raw
  source, personal/business records or private evidence even if it would pass
  these syntactic checks: validation is **not proof of confidentiality**.
  Messages use Slack plain-text blocks, disable mention/link parsing and previews,
  and preserve supplied QA/CI/merge distinctions. The reporter records supplied
  facts; it does not independently verify them or grant acceptance.

### Reliability and acceptance

The reporter must honor the same user stop/control state, without a separate
polling daemon. Persist nonsecret event/delivery receipts and deduplicate by
repository, PR/ticket, revision, SHA, event/role and optional update identifier.
Claim delivery only after
Slack acknowledges the intended channel/message; HTTP success alone does not
make an `ok: false` response successful. Surface missing configuration,
permission failures and delivery errors explicitly, without exposing tokens.
Respect rate-limit retry instructions with bounded attempts. An uncertain
send is not proof of failure: record it for reconciliation instead of blindly
reposting or promising exactly-once Slack delivery.

The command posts only to the official
`https://slack.com/api/chat.postMessage` endpoint with redirects disabled.
One delivered parent per repository/PR (or ticket before PR assignment) receives
subsequent updates in its thread. Moving from ticket-only to a PR creates a new
PR parent, not an inferred link to the earlier ticket thread. All invocations
must share the receipt root; using another root can create duplicates.

Nonsecret, mode-0600 atomic receipts live in `.odee/slack/receipts.json`.
They retain event identity, payload digest, channel/message/thread identifiers,
timestamps, sanitized failure codes and bounded prior-attempt history, **not**
tokens, raw message text or response bodies. Identity is repository, PR/ticket,
revision, full SHA, event/role and optional `updateId`. Identical replay returns
its receipt without sending; changed content or destination under that identity fails
`PAYLOAD_MISMATCH`, including changed content under the same `updateId`. Use a
new stable `updateId` for a genuinely distinct intermediate update; do not
change identifiers to evade an uncertain send's safeguards. Omitted `updateId`
retains the original identity/hash shape and a single event per
SHA/revision/event/role; library `undefined` is equivalent to omission, whereas
`null` and empty strings are invalid. Existing delivered receipts without the
field are neither re-keyed nor rewritten. Supplying an identifier creates a
distinct event, not an alias or automatic migration of an earlier unidentified
event. Channel changes for an existing PR scope fail closed as well.

An exclusive **reporter** lock covers durable pre-send intent through receipt
commit, including the bounded request (10 seconds by default; library maximum
30 seconds). It never holds the scheduler state lock through a network operation.
Control is fully read/validated before preparing a send and again immediately
before the request. Pause/stop suppresses delivery; it cannot recall an in-flight
request or eliminate the race after the final check. No QA or scheduler state
is mutated, even when notification fails.

`status` is read-only and exposes receipts plus lock presence. A crashed process
may leave both a stale exclusive ownership lock and an `intended` receipt.
Do not delete a live lock or infer failure from process death. After proving the
exact lock owner has exited, the coordinator must inspect/reconcile it manually;
there is no automatic stale-lock deletion or uncertain-delivery override here.
`intended` and `uncertain` identities are never resent, even with `--retry`.
An uncertain parent blocks new events for that PR until external reconciliation.
The CLI deliberately provides no automatic reconciliation/receipt rewrite;
retain evidence and resolve with an authorized operator rather than bypassing
the safeguard with another root.

Only acknowledged Slack `ok: true` with the intended channel, valid message
timestamp and (for updates) matching thread acknowledgement is delivered.
`ok: false` is a sanitized failure. Timeouts (including stalled response bodies),
lost/malformed/mismatched responses, redirects, HTTP 408 and server errors are
uncertain. HTTP 4xx rejection and explicit Slack API errors are known failures.
A 429 records `retryAt` from integer `Retry-After` (60 seconds if invalid); there
is no automatic retry or wait loop. An explicit later `send ... --retry` may
retry only known failed/rate-limited/control-cancelled events, after `retryAt`,
retaining earlier failures (at most 20 retries per identity). Delivered and
uncertain events cannot be retried. The bounded store accepts 2000 identities;
exhaustion requires operator planning, never automatic deletion of dedupe state.

Exit codes: 0 for delivery/status/help, 1 for failed/uncertain/invalid commands,
2 for control-suppressed/cancelled sends. Missing config and auth/permission
failures remain explicit sanitized errors. Root/symlink/hardlink checks protect
against accidental path escapes/overwrites; trusted, access-controlled local
directories are still required. This is not a sandbox against another process
with filesystem mutation privileges or a substitute for OS permissions.

Validate formatting, redaction, event deduplication, partial QA/merge labels,
stop behavior, Slack API errors, rate limits and uncertain outcomes with a
mocked transport. Before persistent reporter enablement, verify the rotated
secret, bot channel membership and a deliberately authorized test message.
Notification failure
remains visible but never changes a QA verdict, invents delivery or bypasses a
merge/release gate. No live Slack request is authorized by a synthetic test.

## Feature pull requests and merge tracking

Use one pull request per independently testable feature ticket. Keep its repair
commits in the same PR so the failed candidate, fix and independent retest remain
traceable. Split a ticket before implementation when it contains independently
deliverable outcomes; do not manufacture tiny PRs just to increase the count.
The coordinator publishes branches and manages PRs; feature workers and testers
retain their existing ownership and cannot merge their own work.

Open a draft once there is a coherent committed candidate. Use the
[repository PR template](../.github/PULL_REQUEST_TEMPLATE.md). Each PR records:

- Ticket ID, specification revision, full candidate SHA and base branch/SHA.
- User outcome, included/excluded scope, dependencies and linked predecessor PRs.
- Acceptance criteria, required independent roles and their current verdicts.
- Exact tested SHA, commands, results, skips and unavailable evidence.
- Failed-candidate findings, repair commits and renewed retest results.
- Compatibility implications, known limitations and human-only external gates.

Keep published evidence synthetic and sanitized. Do not upload ignored ledgers,
private handoffs, credentials, real records or private browser captures. A tester
reports through its isolated QA handoff; the coordinator posts an attributed
summary with the tested SHA. Do not impersonate a GitHub reviewer or describe
agents sharing one GitHub account as independent GitHub review identities.

Draft is not acceptance. Mark ready only after all required roles pass for the
current specification and exact candidate. A changed head or contract invalidates
the relevant evidence; an earlier green SHA does not approve the new head.
Required GitHub CI must also succeed. Local test results are not remote CI.

Dependent features may use stacked PRs against their prerequisite branches. Link
the stack and merge prerequisites first. Keep those branches until dependents
are retargeted. Recheck the resulting diff, merge candidate and affected tests
after a base change or conflict resolution; never assume a green lower PR
approves the complete stack.

Immediately before a GitHub merge, the coordinator must verify running control,
the exact-SHA/specification ledger gate, required independent verdicts, required
remote checks, resolved blocking discussions and current repository protections.
Reconcile changes already on the destination branch without dropping them and
renew integration evidence on the resulting candidate. Use a normal merge commit
to retain the original feature and repair commits, with an exact-head guard;
never force-push, squash away the repair history, use an admin bypass or merge
an unprotected destination unattended. If protections or required evidence are
missing, leave the PR open and continue other safe work.

The ledger's `merged` entry records local integration already performed. It is
not proof that a GitHub PR merged into `main`. Track the PR URL, base/head and
actual remote merge commit separately, and do not rewrite historical local
acceptance records to imply a remote merge.

Already-integrated historical work may need an explicitly labelled foundation
bundle and stacked feature PRs. Preserve its commits and disclose combined scope
instead of claiming that interleaved historical work was independently developed
or tested as separate PRs.

Publishing a development branch or merging a verified PR does not authorize a
release, deployment, provider transmission or production migration. Recheck
push/PR/merge triggers before publishing. Release tags, GitHub Releases and live
business actions remain human-controlled.

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
NODE_ENV=test node --test tools/agents/*.test.mjs web/tests/test-environment.test.mjs
```

The focused `NODE_ENV=test node --test tools/agents/loop-planning.test.mjs`
drill consumes the committed D013/D014 planning packet and source links. It
rehearses revision-1 → revision-2 reconciliation for existing ODEE-004/011 in
disposable local fixtures, including failure/handoff retention, stale approval
rejection and idempotent repeated deltas. Its synthetic workers, hashes and
merge records are **not delivered application features or production QA**.

The existing frontend/browser prerequisites still apply. The authenticated,
disposable-MongoDB persistence rehearsal is separate from the demo suite. Run
from the repository root with the allowlisted test environment, overriding
`NODE_ENV` only for the production bundle, never for the tests:

```sh
node --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { safeTestEnvironment } from './tools/agents/workspace.mjs'
const env = safeTestEnvironment({ NODE_ENV: 'test' })
try {
  for (const [command, args, mode] of [
    ['npm', ['run', 'build'], 'production'],
    ['npm', ['run', 'test:e2e'], 'test'],
    [process.execPath, ['tests/persistence.mjs'], 'test'],
  ]) {
    const result = spawnSync(command, args, {
      cwd: 'web', env: { ...env, NODE_ENV: mode }, stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
  }
} finally {
  rmSync(env.ODEE_TEST_SCRATCH_DIR, { recursive: true, force: true })
}
NODE
```

The build is `NODE_ENV=production npm run build` **inside that sanitized
environment**; browser/persistence tests remain `NODE_ENV=test`. Do not copy
live `.env` files, inherit provider credentials or point tests at shared 8098.

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
