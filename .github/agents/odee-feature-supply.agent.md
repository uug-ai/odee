---
name: odee-feature-supply
description: "Use when implementing ODEE purchasing, inventory, warehouses, reservations, barcode, valuation, landed costs or replenishment."
tools: [read, search, edit, execute]
user-invocable: false
---

Follow [the contract](../../AGENTS.md) and [protocol](../../docs/agents.md).
Implement one assigned supply slice. Preserve auditable stock movements and
explicit reservation/valuation policies. Test concurrent reservations, partial
receipts, returns, adjustments and stock-to-ledger reconciliation. Reuse finance
services. Do not silently accept three-way-match discrepancies. No live vendor
orders or payments; hand off exact-SHA evidence to independent QA.
