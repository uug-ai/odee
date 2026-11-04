# English and Dutch workspace

The current shell, accounting, contacts, bill inbox/review and permission
surfaces support English (`en`) and Dutch (`nl`). The language control is
available before authentication, in the workspace header and inside dialogs.
Changing it does not navigate, refetch, resubmit or change financial policy.

## Selection contract

1. A valid explicit `odee.locale` local-storage choice (`en` or `nl`) wins
   without reading browser language preferences.
2. Otherwise, the first supported language in `navigator.languages` wins
   (including regional variants such as `nl-BE`).
3. If neither language is supported or browser preferences are unavailable
   (including undefined or throwing getters), English is the deterministic
   default. Non-array preference values are ignored; non-string array entries
   are skipped.

An explicit choice survives reload/history and sign-out on that browser
origin. When storage is unavailable, the choice works for the current tab.
`html.lang` follows the selection. Required, email, quantity and date constraint
messages come from the catalogs, including after switching an invalid dialog.
Native date picker presentation still follows browser/platform conventions.

## Catalog and data boundary

`web/src/locales/nl.ts` declares all message IDs and Dutch translations;
`web/src/i18n.ts` exposes complete English/Dutch catalogs and a typed `t`.
English source messages are stable IDs, including typed named interpolation.
Unknown keys and missing interpolation fail rather than displaying a key as a
finished translation. New registered modules must supply cataloged display
messages, not untyped labels.

Internal routes, filters, status codes, capabilities, audit identities and API
field names remain stable. Only their display labels change. The eight fixed
starter-account names are translated at display time only when both the code
and original stock name match. Custom names, partner/contact names, tags,
references, line descriptions, source websites, OCR text, filenames and
historical snapshots remain original data.
Known scan-method codes (`pdf text`, `pdf + ocr`, `ocr`) have cataloged display
labels, including “PDF-tekst” in Dutch. Stored machine codes and original text
are unchanged; unknown methods are explicitly labeled original diagnostics.

Known validation/conflict messages are mapped to the catalogs without changing
the API error object, HTTP status or retry behavior. Unknown operational
diagnostics are explicitly prefixed “Original diagnostic” / “Oorspronkelijke
diagnose”; known OCR review warnings are cataloged as well. This is not a
missing-key translation fallback. A 403 retains the authenticated identity;
401 expiration clears protected state as before. No automatic write retry is
introduced.

## Exact values

- Editable prices/payments use ungrouped `100.05` (English) or `100,05`
  (Dutch). Reject grouping, mixed/wrong separators, negatives, exponents and
  more than two decimals rather than guessing.
- Existing integer cents are converted by decimal-string operations.
  Currency displays use integer/BigInt grouping and remainder, never floating
  point ledger arithmetic. Switching language in an open dialog reformats valid
  amount edits and retains invalid edits **with their source locale** for
  correction. For example, English `1,05` remains invalid after switching to
  Dutch, and Dutch `1.05` remains invalid after switching to English. Saving
  untouched invalid text never sends a write, even after repeated switches
  or when the edit had not yet been submitted. Explicit user re-entry under
  the current language restores normal parsing. This applies to new and edited
  invoices/bills, scanned review and customer/vendor payments.
- Quantities remain whole-number inputs with the existing bounds.
- Date-only display is `DD/MM/YYYY` (English), `DD-MM-YYYY` (Dutch).
  Strict shared format/parse helpers reject invalid calendar dates without
  constructing timezone-sensitive `Date` objects. Native date inputs continue
  to read/write ISO `YYYY-MM-DD`; locale changes never rewrite those values.
- API requests, stored cents, quantities, ISO dates, CSV numeric contracts and
  historical snapshots remain locale-independent.

Legal PDFs/Peppol and fractional quantities are not localized or enabled here.

## Validation and isolated browser boundary

Run frontend tests with a `safeTestEnvironment` and `NODE_ENV=test`; production
bundles must explicitly use `NODE_ENV=production` in that sanitized environment.

```sh
NODE_ENV=test node web/tests/localization.mjs
NODE_ENV=test node web/tests/capabilities.mjs
```

Both runners sanitize their child environment and use disposable MongoDB,
synthetic protected app fixtures and owned literal `127.0.0.1` listeners.
`localization.mjs` starts with all ten persisted local-transport guards. Every
new context explicitly binds the committed `local-transport.mjs` proxy with
`<-loopback>`; API/health requests use its no-follow wrappers. GitHub authorize
locations are inspected as text, then fulfilled with local mock consent/state
cookies. No actual provider is visited.

The locale runner exercises real EN/NL OAuth, contact creation/Odoo JSON
import, invoice creation, invalid input, stale conflict, posting, excessive
payment rejection, partial payment, actual PDF scan/review, bill posting/payment,
language persistence, history/reload, responsive layout, keyboard/focus, real
403 and expired-cookie behavior. Its independent amount oracle is
`24200 - 10000 = 14200`, with every journal balanced and owned documents
unchanged after a server restart. Go JSON event summaries distinguish
top-level tests from subcases and list every skip; the opt-in browser fixture
is covered by the subsequent actual journeys.

Normal `web/tests/**/*.spec.ts` discovery now includes:

- `localization.spec.ts`: separate English/Dutch protected journeys through the
  same committed runner, including invalid-money provenance on seven monetary
  surfaces per language. Its `--browser-only` selection avoids recursively
  starting Playwright or duplicating the broad Go suite/transport-guard suite.
  Normal discovery retains all ten standalone transport guards.
- `localization-startup.spec.ts`: the production application in fresh,
  proxy-bound browser contexts, retaining twelve supported preference rows
  plus two unavailable-storage rows, and adding nine unavailable/malformed
  preference or saved-choice-precedence cases.

The normal selection is 59 Playwright cases: 24 historical, ten transport
guards, 23 startup cases and two protected locale selections. Each locale
selection executes three child browser cases; these are not six additional
top-level Playwright tests. No package/workflow/config changes are required.

The historical normal Playwright suite predates that permanent boundary.
Do not run it unguarded: use the disclosed launch-only safety wrapper/config
when reproducing that suite. Such a wrapper is **not** evidence that the old
runner has permanent transport safety. Do not use shared port 8098, existing
browser data, `.env.local`, live MongoDB or real OAuth/Peppol endpoints.
