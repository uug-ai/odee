# ODEE development contract

Read [the agent operating guide](docs/agents.md) and the assigned versioned
ticket before editing. The [roadmap](docs/roadmap/README.md) defines approved
product scope. Consult centralized project memory first when available;
never recreate obsolete local memory.

- Preserve unrelated uncommitted changes. In default ledger mode, work in
  assigned worktrees under `/home/vscode/worktrees/`, not inside the monorepo.
  Only after the temporary app-managed fallback is explicitly adopted as
  described in `docs/agents.md`, use its host-assigned isolated worktree path.
- Keep Go, React/TypeScript and MongoDB. Extend the existing application with
  bounded vertical slices, not speculative frameworks or a rewrite.
- Preserve BSON ObjectID ownership. A valid legacy `ownerId` fills missing
  `organisationId` and `projectId` axes at runtime, without requiring migration.
  Never replace a nonempty canonical axis or infer ownership from identity,
  creator, recipient, payer, actor or imported provenance.
- Preserve historical financial values and snapshots. Use exact monetary
  arithmetic, explicit conflicts and tested atomicity/retry behavior.
- Authentication is not authorization. Enforce capabilities server-side.
- Implement English/Dutch and relevant accessibility behavior together.
- Use synthetic fixtures, disposable databases and isolated ports. Never load
  `.env.local` or reuse live credentials for tests.
- Compare shared Odoo/ODEE browser screens read-only unless explicitly assigned
  an isolated test server. Do not copy real records into fixtures or evidence.
- A feature author cannot provide its own final QA verdict. Bind evidence to
  candidate SHA and specification revision; retest changed contracts.
- The project manager owns product priorities, the coordinator dispatches and
  integrates, feature workers build, and independent testers verify.
- Check the shared control root before dispatch, new work or integration.
  Honor stop/pause and persist handoffs; do not spin on repeated failures.
- Human-only actions: releases/tags, release artifact publication, deployment,
  production migrations, destructive real-data changes, live payments, filings,
  Peppol sends, paid signup and real customer communications.

Instructions and agent personas are not a security sandbox. Repository
permissions, protected branches/environments, isolated credentials and explicit
human authorization must enforce the release and data boundaries.
