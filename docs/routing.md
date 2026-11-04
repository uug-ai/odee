# Workspace routes (ODEE-004 revision 3)

The existing module/view registry in `web/src/modules.ts` is the client routing
authority. No router dependency or business module was added.

| Path | Existing view |
| --- | --- |
| `/` | Launcher |
| `/accounting` | Dashboard |
| `/accounting/invoices` | Customer invoices |
| `/accounting/bills` | Vendor bills |
| `/accounting/journal` | Journal entries |
| `/accounting/accounts` | Chart of accounts |
| `/accounting/reports` | Trial balance |
| `/contacts` | Contacts |

Paths are exact and case-sensitive. Unknown paths, including planned Sales,
Projects and Inventory, receive the public shell but render an explicit
not-found page with a real launcher link; HTTP 200 is not module activation.
The new not-found strings follow the browser language (`nl*` or English
fallback) and mark their section language. This is not whole-app localization;
ODEE-006 remains separate.

`useWorkspaceRoute` reads the initial pathname and handles native Back/Forward.
Only explicit navigation pushes history, and repeated navigation to the current
canonical path does not add an entry. Navigation/traversal closes accounting
selections/dialogs and remounts registered module-local transient UI without
submitting writes. Search/hash are not return destinations and are stripped on
explicit navigation to a canonical view.
An already-submitted draft/post/payment may complete, but its late response
cannot reopen a document selection or replace transient UI on a later route.

Authentication gates protected data independently of the shell URL. Session
expiry/logout clears private state without losing the requested registered path.
Existing generation checks still reject late workspace responses after logout.
Company tokens remain in tab memory only, so reload requires token entry again.

GitHub sign-in carries a canonical `returnTo` path. The server validates exact
registered paths and, if absolute, the configured origin; external/protocol-relative,
credential-bearing, queried, fragment-bearing and unregistered destinations fall
back to `/`. The bounded allowlist in `internal/accounting/auth.go` mirrors the
client registry at this trust boundary and must be updated/tested with any future
active route. The validated destination lives in the signed, HttpOnly,
short-lived OAuth-state cookie, not callback query parameters or browser storage.
Existing state/PKCE, team authorization, session, CSRF and origin checks remain.

The Go shell fallback excludes the exact `/api`, `/auth`, `/assets`, `/healthz`
namespaces and their descendants. Existing handlers/errors, static assets and
health responses are not converted into SPA successes. No API authorization is
performed by client route registration.

Focused validation: frontend routing units; Go shell/auth tests (offline mocked
GitHub); `web/tests/routing.spec.ts` (isolated synthetic server with browser-only
GitHub mocks). Existing accounting, contacts, imports and auth browser suites
remain regression gates. Build with `NODE_ENV=production`; run tests with
`NODE_ENV=test`, a fresh `ODEE_TEST_PORT` and sanitized fixture environments.
