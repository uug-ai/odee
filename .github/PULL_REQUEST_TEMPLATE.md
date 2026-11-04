## Feature and contract

- Ticket / specification revision:
- User outcome:
- Included / excluded scope:
- Base branch and full SHA:
- Candidate full SHA:
- Prerequisite PRs:

Keep one independently testable feature in this PR. Keep repair commits here
instead of opening another PR for each failed acceptance round.

## Acceptance evidence

| Criterion | Independent expected result | Evidence / result |
| --- | --- | --- |
| | | |

| Required tester role | Tested full SHA / revision | PASS / FAIL / BLOCKED | Evidence |
| --- | --- | --- | --- |
| | | | |

Leave verdicts unclaimed until the assigned independent tester reports them.
Feature-author validation is not independent acceptance. A changed candidate or
contract requires renewed affected verdicts, not an approval copied from an old
SHA. Reports posted by the coordinator must identify the actual tester role;
agents sharing an account are not separate GitHub review identities.

## Checks and repair history

- Commands and measured results:
- Skipped / unavailable checks and why:
- Findings, failed candidate SHAs and repair commits:
- Compatibility, ownership and historical-data checks:
- English/Dutch and browser coverage, where applicable:
- Known limitations / external professional or provider gates:

Only publish synthetic, sanitized evidence. Do not attach private ledgers,
handoffs, credentials, real records or private browser captures.

## Coordinator merge gate

- [ ] Required independent roles pass for the current candidate and contract.
- [ ] Required remote CI checks pass; local checks are reported separately.
- [ ] Predecessors are merged; retargeted diffs and integration changes are tested.
- [ ] Destination changes are preserved and required protections are enforced.
- [ ] Blocking findings and conversations are resolved, not waived.
- [ ] Control is running and the merge is guarded against a changed head.
- [ ] A normal merge commit will retain feature and repair history.

Keep draft while required evidence is missing. Do not bypass protections, use an
admin merge, force-push or squash away the repair trail.

## Remote outcome

- Actual merged PR / commit (complete only after the remote merge):
- Remaining follow-up tickets:

Local ledger integration is not a GitHub merge. This PR does not authorize
release tags, GitHub Releases, deployment, production migration or live business
actions.
