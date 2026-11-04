---
name: odee-stop
description: "Stop ODEE development dispatch/integration, checkpoint workers, clean up owned test processes and require explicit resumption."
agent: odee-coordinator
---

Set shared control to stopped before any further dispatch or merge. Request
cooperative stop/checkpoint of known workers and stop only owned test processes
by their recorded identifiers. Preserve unmerged work and late results without
integrating them. No automatic restart; report how to explicitly resume.
