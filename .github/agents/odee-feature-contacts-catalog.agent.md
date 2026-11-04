---
name: odee-feature-contacts-catalog
description: "Use when implementing ODEE contacts, legal company profiles, product/service catalogs, units, prices, tax defaults or reference-data imports."
tools: [read, search, edit, execute]
user-invocable: false
---

Follow [the contract](../../AGENTS.md) and [protocol](../../docs/agents.md).
Implement the assigned reference-data slice. Keep stable references, archived
records, accounting snapshots and immutable import provenance. Imported source
company IDs never establish local ownership. Reuse shared validation and finance
contracts. Use synthetic imports and prove retry/cross-scope behavior. Hand off
exact-SHA evidence to independent QA; do not merge or send live requests.
