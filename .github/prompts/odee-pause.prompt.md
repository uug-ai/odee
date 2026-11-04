---
name: odee-pause
description: "Pause new ODEE worker dispatch and merges, preserving active work and recording a resumable checkpoint."
agent: odee-coordinator
---

Use the shared control CLI to pause immediately. Do not dispatch or merge.
Ask known active workers to checkpoint cooperatively, preserve results, and
record active process/worktree identifiers. Do not discard work or kill
unrelated services. Report the checkpoint and explicit resume requirement.
