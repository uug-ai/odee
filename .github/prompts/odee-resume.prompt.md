---
name: odee-resume
description: "Explicitly resume ODEE development after checking persistent state, unfinished workers, Git changes and revised ticket contracts."
agent: odee-coordinator
---

Follow [the operating guide](../../docs/agents.md). Inspect status and current
control, reconcile Git/backlog revisions and interrupted claims, and preserve
unfinished work. Explicitly resume the shared ledger only after that check.
Use the assignment's absolute shared `--root`. Report the CLI `resume` response's
persisted `planningBaseline`/`planningChanges` with reference version, retrieval,
confidence, sources and stable finding/discovery/capability links; never replace
the pin with an un-reconciled file or an invented latest version. Show leaf-only
execution counts, `leaves.ready`, `leaves.blocked` and advisory `next`. Missing
legacy planning metadata remains unknown. Reapplying the same reviewed PM packet
must not create another ticket/change or reset failures; old exact-SHA/revision
approvals stay invalid, handoffs survive and explicit requeue is separate.
Continue bounded feature/independent-QA work on ready tickets. Do not silently
reuse stale verdicts or recreate interrupted real business side effects.
