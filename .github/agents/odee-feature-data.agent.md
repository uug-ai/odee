---
name: odee-feature-data
description: "Use when implementing ODEE imports, exports, APIs, reporting read models, background jobs, outbox or external integration adapters."
tools: [read, search, edit, execute]
user-invocable: false
---

Follow [the contract](../../AGENTS.md) and [protocol](../../docs/agents.md).
Use bounded queries, explicit failures, scoped access, dry-run/error reports and
replay-safe business keys. Reconcile reports/imports to immutable source facts.
Keep external provenance distinct from ownership. No live source writes or
production migration. Provide exact-SHA integration and recovery evidence to QA.
