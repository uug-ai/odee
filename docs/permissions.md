# Company permissions and financial attribution

`ODEE_AUTH_MODE` still selects authentication. GitHub requires an active team
membership at login, a signed unexpired session and CSRF/origin verification.
Token mode verifies the existing bearer credential. Explicit development mode
remains loopback-only; neither token nor development bypasses GitHub mode.

## Startup configuration

`ODEE_AUTHZ_MODE=compatibility` is the default: authenticated, unmapped principals
retain `read`, `write`, `post`, **not** `admin`. This preserves existing workflows,
not per-person isolation. `enforced` denies an unmapped authenticated principal
with 403. Missing/invalid authentication is 401.

`ODEE_CAPABILITY_GRANTS` is a JSON array, loaded and validated before storage is
opened. Restart to apply changes. Each record has:

- `principal`: `github:<positive numeric user ID>`, `token:company`, or
  `development:local`. GitHub login names are not stable identities.
- `companyId`: nonzero BSON ObjectID hex for the configured company.
- `capabilities`: an explicit subset of `read`, `write`, `post`, `admin`, including
  an empty array when no business actions are allowed.

Unknown fields/capabilities, malformed identifiers and conflicting duplicate
principal/company grants prevent startup. Identical sets may be repeated.
An explicit current-company grant **replaces**, never augments, compatibility
rights. A principal with only foreign-company grants is denied without fallback.
No first-login, team-derived or automatic owner administrator exists. There is
no grant administration API or role hierarchy.

**Human gate:** identify initial admin principals and approve explicit grants
and enforced activation before changing shared/live deployments. Synthetic test
fixtures do not activate any shared deployment. Do not copy fixture grants into
production. This implementation changes no real grants or data.

## Exhaustive business route matrix

| Required capabilities | Routes |
| --- | --- |
| `read` | `GET /api/state`, `GET /api/contacts`, `GET /api/imports/{id}`, `GET /api/imports/{id}/original`, `GET /api/imports/{id}/preview` |
| `read`, `write` | `POST /api/documents`, `PUT /api/documents/{id}`, `POST /api/contacts`, `PUT /api/contacts/{id}` (including archive), `POST /api/contacts/import`, `POST /api/imports`, `POST /api/imports/{id}/scan`, `POST /api/imports/{id}/draft` |
| `read`, `post` | `POST /api/documents/{id}/post`, `POST /api/documents/{id}/payments` |
| `read`, `admin`, target ownership | `GET /api/documents/{id}/audit` |

Capabilities imply nothing else. A poster cannot edit, an editor cannot post,
and an audit administrator cannot make financial changes without `post`.
Checks precede protected work; disabling browser controls is not authorization.
Public shell/health/auth routes remain usable. `/api/session` discloses only the
current authenticated principal's auth mode, authorization mode, membership,
company and capabilities, plus existing GitHub user/CSRF discovery. Logout keeps
its existing authentication and CSRF checks regardless of company permissions.
403 does not expire the session or automatically retry a write. Ask the workspace
administrator for the missing capabilities; refresh permissions after a
configuration restart. Toegang geweigerd betekent niet dat je afgemeld bent:
vraag je beheerder om toegang en vernieuw daarna je rechten.

Canonical BSON `organisationId` and `projectId` retain precedence independently.
A missing axis falls back to a valid stable `ownerId`; both absent axes become
the owner's deterministic default project. No migration is required. Principals,
login names, actor and imported IDs never supply or overwrite ownership.

## Financial-only audit

Only new successful `document.post` and `manual-payment.record` actions acquire
attribution. A bounded embedded `financialEvents` array contains server-generated
ObjectID event ID, UTC time, actor type/principal, action, target ObjectID/version
and `committed` outcome. It is appended in the **same owner/version-filtered
document update** as the financial mutation and version increment. No replica
set or transaction is required. One post and the existing 200-payment limit bound
history to 201 events; history is never silently trimmed or replaced by ordinary
document updates. Memory storage preserves the same append and conflict rules.

Stale, denied, duplicate-key and invalid operations append no event. A lost
Mongo acknowledgement returns 503 `reconciliation_required`: inspect the latest
document/version and, with admin access, its history before deciding whether to
retry. A failed response proves neither absence nor exactly-once execution.
Do not silently reissue an unsafe request.

Ordinary document/state JSON never contains events. The scoped admin endpoint
returns an allowlisted attribution projection, not credentials, hashes, CSRF,
raw payloads, contact fields or OCR data. Shared `token:company` and
`development:local` attribution identifies a credential/mode, **not a human**.
Historical documents without history remain valid; no historical actor is
invented. Contact/draft/import/upload/scan/review-to-draft auditing remains
**PROPOSED**, under `PF-AUDIT-NONFINANCIAL-001`, not delivered by this feature.

## Synthetic validation

After the existing frontend dependencies are restored and an explicitly
`NODE_ENV=production` frontend bundle is built, run:

```sh
NODE_ENV=test node web/tests/capabilities.mjs
```

The runner constructs an allowlisted environment, fresh standalone MongoDB,
isolated databases/listeners and a test-only local OAuth provider. It runs the
Go race suite and actual browser capability/403/401 journeys. It never uses live
GitHub, shared 8098, `.env` files or real grants. Required OCR/PDF tools and a
local Playwright Chromium installation remain prerequisites. The normal browser,
Mongo disk-restart, OCR and authenticated persistence suites remain required
regressions; this runner does not substitute for independent exact-SHA QA.
