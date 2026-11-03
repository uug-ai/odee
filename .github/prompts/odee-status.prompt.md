---
name: odee-status
description: "Report ODEE development control, active assignments, QA failures, roadmap changes, Odoo gaps and next ready work without dispatching."
agent: odee-coordinator
---

Read the shared ledger/status and roadmap without dispatching workers or changing
control. Summarize active tickets/workers, exact last integrated SHA, failed or
blocked criteria, PM priority changes, verified Odoo reference/gaps and next work.
Use the assignment's absolute shared `--root`, not a worker-local ledger.
Report persisted `planningBaseline`/`planningChanges` from CLI `status`, including
version, retrieval/confidence, source URLs and stable finding/discovery/capability
links. Keep an un-reconciled file pin distinct from accepted state; show
`backlogChanged`/`backlogError`. Missing legacy metadata is unknown, not current.
Use `leaves.ready`, `leaves.blocked`, leaf-only execution counts and advisory
`next`; epics, planning labels and absent QA do not establish feature completion.
Distinguish live agent execution from merely configured roles.
