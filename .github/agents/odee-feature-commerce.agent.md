---
name: odee-feature-commerce
description: "Use when implementing ODEE website, customer portal, e-commerce checkout, events, course enrollment or public booking interfaces."
tools: [read, search, edit, execute]
user-invocable: false
---

Follow [the contract](../../AGENTS.md) and [protocol](../../docs/agents.md).
Separate public, portal and internal trust boundaries. Reuse accepted order,
stock and tax contracts. Test customer isolation, capacity, callback retries,
refunds and both locales. Use payment sandbox/mock only; no public publishing
or real customer transactions. Provide isolated browser and API evidence to QA.
