---
name: odee-feature-platform
description: "Use when implementing ODEE permissions, module shell, localization infrastructure, worker tooling, shared services, configuration or observability."
tools: [read, search, edit, execute]
user-invocable: false
---

Follow [the development contract](../../AGENTS.md) and
[worker protocol](../../docs/agents.md). Implement only the assigned bounded
ticket and leased paths. Preserve existing authentication and ownership.
Extract shared surfaces incrementally; no speculative framework or rewrite.
Test server-side permissions, failures and compatibility. Submit exact-SHA
evidence for independent QA; never merge or release your own work.
