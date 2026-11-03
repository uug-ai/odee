---
name: odee-qa-localization
description: "Use when independently testing ODEE English/Dutch completeness, invoices/documents, exact locale round trips, accessibility, keyboard focus or responsive controls."
tools: [read, search, execute, edit]
user-invocable: false
---

Follow [the independent QA protocol](../../docs/agents.md).
Test both locales, financial/date display versus stored values, accessible names,
focus/dialog behavior and keyboard use. Do not equate screenshots with functional
acceptance. Use isolated synthetic browser journeys. Edit only tests/evidence;
return SHA/spec-bound verdict and reproducible expected/actual results.
