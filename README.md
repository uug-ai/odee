# Odee

An MIT-licensed, open-source business workspace. Accounting is the first tile:
a Go API, React/TypeScript UI, and MongoDB persistence using the shared
`github.com/uug-ai/database` client. This is an independent implementation, not
an Odoo code fork. No live Odoo records, balances, or assets are bundled.

## First Accounting release

- App launcher with Accounting enabled; other applications are labelled Planned.
- Journal-card dashboard for receivables, payables, recorded bank movements,
  indicative VAT, recent documents, and getting-started progress.
- Create and edit customer invoice / vendor bill drafts with up to 100 lines,
  partner details, references, document/due dates, prices, and per-line VAT.
- Post balanced double-entry journals. Posted documents are immutable.
- Record partial/full manual payments, retain payment history, reject
  overpayments and duplicate payment keys, and show paid/overdue states.
- Search/filter documents; view journals, the fixed starter chart, and a
  cumulative trial balance; export the trial balance as CSV.
- Company-scoped MongoDB reads/writes and optimistic concurrency: stale writes
  return HTTP 409 instead of overwriting another change.
- Responsive layout, accessible native dialogs, and keyboard dismissal.
- Drag/drop or browse multiple vendor bills (PDF, PNG, JPEG), scan locally,
  review suggestions alongside the original, and save attached bill drafts.
- Contacts application: company/person cards, search and filters, create/edit,
  soft archiving, read-only Odoo copies and saved-contact selection in drafts.

### Deliberate boundaries

This is a **single-company, EUR bookkeeping foundation**, not a production-ready
replacement for a statutory accounting package. GitHub team login is supported,
but it does not yet provide per-user permissions, editable account charts, opening
balances, credit notes/reversals, fiscal locks, legally sequential invoice
numbers, multi-currency, generated invoice PDFs/email delivery, general attachments, bank feeds,
reconciliation, VAT filings, financial-year reporting, or country-specific
compliance. Do not use it as your sole statutory books yet.

Invoice references use full unique ObjectIDs rather than gapless legal
sequences. Quantities are whole units (1–10,000), prices are integer cents
(up to EUR 10 million/unit), and document totals are capped at EUR 10 billion.
VAT is rounded half-up **per line**; rates in the initial UI are 0%, 6%, 12%, 21%.
These are starter choices, not a Belgian tax-compliance claim. Invoice lines
post to Sales revenue, bill lines to Operating expenses. No bank transfer is
initiated by Record payment. Bank figures represent only recorded movements,
not an imported bank balance. Reports include all posted activity, without
date filters or pagination; this first version targets small workspaces.

## Run with MongoDB

Requirements: Go 1.26.10+, Node 20.19+ (22 recommended), npm, MongoDB 6+.
A standalone MongoDB is supported: posting and payments are single-document
atomic operations, so a replica set is not required.

```sh
cd web
npm ci
npm run build
cd ..
cp .env.example .env
# Edit .env: set GitHub OAuth credentials, a random SESSION_SECRET,
# a dedicated database, company name, and stable company ObjectID.
set -a
. ./.env
set +a
GOWORK=off go run ./cmd/odee
```

Open **http://localhost:8098** (matching `ODEE_ORIGIN`). The backend serves the compiled frontend and API
on the same origin. Environment files are not loaded automatically.

Normal mode requires `MONGODB_URI`; there is **no automatic memory fallback**.
Connection, ping, and required-index failures prevent startup. One client is
reused throughout the process and disconnected during graceful shutdown.
Driver pool defaults are retained. A 10-second context bounds startup and API
operations for this interactive OLTP workload; monitor pool wait time,
connection counts, and operation latency before tuning the pool.
Import requests have a separate 180-second context for local scanning.

The app creates `accounting_documents`, `contacts`, `bill_imports.files` metadata,
GridFS `bill_imports.chunks` when used, and required indexes. Use a
dedicated database, least-privilege credentials, TLS for nonlocal MongoDB,
backups, and a tested recovery process. Never point unattended tests at your
production database. Application validation enforces this release's schema;
database-level validators and accounting-role authorization are future
hardening work.

### Explicit temporary demo

No MongoDB is needed for the opt-in local demo. It starts **empty**, displays a
temporary-storage banner, and loses all records on process restart.

```sh
ODEE_AUTH_MODE=token ODEE_DEMO=true ODEE_DEV_MODE=true GOWORK=off go run ./cmd/odee
```

This is not a persistence mode and is never selected because a database failed.

From the monorepo VS Code workspace, **Tasks: Run Task → odee: run demo**
starts the same temporary demo at **http://localhost:8098** in a dedicated terminal.

### Persistent local workspace

Copy `.env.example` to `.env.local` and configure GitHub OAuth credentials
and a random persistent `SESSION_SECRET` first. The callback must permit
`http://localhost:8098/auth/github/callback`. Then build the frontend and run
**Tasks: Run Task > odee: run local** from the monorepo workspace.
It starts a dedicated standalone MongoDB on loopback port 27028 and the app at
**http://localhost:8098**, using database `odee_local`. Stop any existing Odee
demo on that port first; temporary demo records are not transferred.

The MongoDB binary is cached/downloaded using the existing development tooling.
Database and original-file data live in the ignored `.local-data/mongo` directory
and survive app/database restarts. Do not delete that directory to restart the
app. It is local development storage, not a hosted production database or a
backup. Keep app/MongoDB ports private and back up valuable documents.

### Frontend hot reload

For explicit unauthenticated local hot reload, run the API with
`ODEE_AUTH_MODE=token ODEE_DEV_MODE=true ODEE_ORIGIN=http://127.0.0.1:5188`,
then in a second terminal:

```sh
cd web
npm run dev
```

Open **http://127.0.0.1:5188**; Vite proxies `/api` to port 8098. Match
`ODEE_ORIGIN` to the exact browser origin, including port and hostname.

## Container and staging

The container serves both the Go API and built frontend on port 8098. It runs
as UID/GID 10001 and includes Poppler, Tesseract and the English, Dutch and French
language packs. Runtime application credentials are not built into the image.
Provide a writable private `/tmp` for scanning when using a read-only filesystem;
original documents use MongoDB GridFS. To also save new uploads on a mounted
volume, set `ODEE_DOCUMENTS_DIR` to its absolute writable path.

GitHub Actions runs backend race tests/vet, frontend tests/build, isolated MongoDB
tests, native scanner tests and browser tests. Both Linux amd64 and arm64 runtime
images are built and scanned; HIGH/CRITICAL findings block the security check.
Creating a GitHub release publishes its versioned multiarchitecture image to
`ghcr.io/uug-ai/odee` through the organisation's shared release workflow and
verifies the published image again.

The staging target is **https://odee.uug.lol** on Bijlokehof, namespace `staging`.
Use an isolated `odee-staging` database, GitHub authentication for
`uug-ai/engineering`, an Odee-specific persistent session key, and
`ODEE_ORIGIN=https://odee.uug.lol`. Development/demo modes must remain disabled.
The OAuth app must explicitly permit
`https://odee.uug.lol/auth/github/callback`; do not replace Calendar's or local
development's callback. No existing local or Odoo records are imported by
deployment. Container registry pull access must be verified before promotion.

## Import and scan vendor bills

Open **Accounting > Bills**, drop bills onto the page, or select **Choose bills**.
Each file is retained unchanged and scanned locally. Review the supplier,
reference, dates, EUR currency, line amounts, VAT and total alongside the original
preview. A required confirmation saves **only a draft**. Posting remains a
separate explicit action; importing never posts entries or initiates payment.
**View original** and **Download original** remain available after posting.
These are uploaded originals, not generated customer-invoice PDFs.

Install the local tools on Debian/Ubuntu:

```sh
sudo apt-get install poppler-utils tesseract-ocr \
  tesseract-ocr-eng tesseract-ocr-nld tesseract-ocr-fra
```

Digital PDF text uses Poppler; pages without useful text and images use
Tesseract. No files or extracted text are sent to an external OCR/AI provider.
The field extractor is a best-effort English/Dutch/French label parser, not
guaranteed invoice understanding. Numeric dates use day/month/year. Reconciled
rows are proposed when possible; otherwise a reconciled summary line or manual
completion is required. Missing/ambiguous fields are flagged. Non-EUR documents
are retained but cannot be converted into EUR bills. A difference between the
entered and scanned total needs explicit acknowledgement.

Limits: 20 MiB/file, 20 files/batch, 10 PDF pages, and 20 million pixels/image
(maximum 20,000 pixels per dimension). Batches process serially; the server
accepts two concurrent uploads/scans. Scanning is bounded to 120 seconds and
preview rendering to 20 seconds. Private temporary scan files are removed after
processing; originals remain in company-scoped GridFS, with additional copies on
the explicitly configured document volume.

Byte-identical duplicates reuse the existing original. A matching supplier and
invoice number on an existing bill produces a warning, not an automatic
decision. Failed scans retain originals in the document inbox for manual review
or **Retry scan**. After an uncertain request result, refresh before retrying.
Interrupted scans can be retried after three minutes. Draft conversion uses a
stable original ID so retrying cannot create a second bill.

In **demo mode**, both bills and original files are temporary (200 MiB total
original-file memory limit) and disappear on restart. Use MongoDB for real
documents and include the MongoDB records, both GridFS collections and any
configured document volume in backups. Missing OCR tools
disable scanning, not original storage or manual draft creation.

### Persistent document volume

Set `ODEE_DOCUMENTS_DIR=/data/documents` and mount a persistent filesystem at that
path to also store new original uploads on disk. The directory must already exist and
be writable by UID/GID 10001 in the container; missing, read-only or relative paths
fail startup. The read-only container root remains enabled, and OCR scratch stays
separate in `/tmp`. Do not point this setting at an `emptyDir` or the image layer.

Accounting, contacts, import metadata and shared original downloads still use
the configured MongoDB/GridFS database. This preserves access from a local
workspace sharing the database without access to the staging PVC. Existing
originals remain readable without migration; historical files and duplicates
are not automatically backfilled onto the volume.

The configured volume is mandatory for each new upload on that deployment:
Odee syncs and atomically publishes a disk copy before committing GridFS bytes
and metadata. A missing/unwritable volume or inconsistent existing copy fails
the upload, never silently skips the copy. Disk copies are scoped by BSON
organisation/project IDs and a SHA-256 content key, never by user filenames;
concurrent duplicates share one verified file. Scan/review metadata updates
cannot change its path. A failed MongoDB acknowledgement never deletes a
published copy: an unreferenced file may remain for retry/recovery.

GridFS remains the authoritative source for downloads and scanning, not a
fallback for disk reads. Keep the same PVC and a volume-aware image on rollback
to continue making disk copies; an older image would leave them incomplete.

Back up MongoDB and the volume together, quiescing uploads for a coordinated
snapshot; retain GridFS backups for historical originals. A PVC is persistence,
not a backup. Uploaded supplier invoices/bills remain originals, not generated
customer-invoice PDFs.

## Contacts and copying from Odoo

Open the **Contacts** tile or the Contacts link in the workspace navigation.
Create/edit companies and people, search names/email/phone/VAT/address/tags, and
filter companies, people, customers, vendors or archived records. Uncheck
**Active** while editing to archive; contacts are not hard-deleted.
Invoice and bill editors can copy a saved contact's name/email into a draft.
Those are accounting snapshots: subsequent contact changes do not rewrite
existing invoices or bills.

Contacts live in their own company-scoped MongoDB `contacts` collection.
Each bounded `profile` embeds the address and at most 50 tags. Version-guarded
edits preserve immutable Odoo provenance. Legacy `ownerId` compatibility uses
the same runtime ownership rule as accounting; no migration is required.

**Import Odoo JSON** accepts a normalized, authorized read-only export, up to
2 MiB / 1,000 records per request. The source Odoo instance is never changed.
Odoo itself uses PostgreSQL; Odee stores these copies in MongoDB. Odoo
credentials and real contact records must never be added to Git or test fixtures.

```json
{
  "source": "https://odoo.example.invalid",
  "database": "example",
  "contacts": [
    {
      "externalId": 123,
      "parentId": 0,
      "companyId": 1,
      "name": "Example company",
      "isCompany": true,
      "email": "accounts@example.invalid",
      "type": "contact",
      "active": true,
      "customer": true,
      "tags": [],
      "address": {"city": "Brussels", "country": "Belgium"}
    }
  ]
}
```

The full format also supports company/affiliation, phone, mobile, website,
VAT/tax ID, reference, customer/vendor flags, street, street 2, postal code,
state/province and country. Map Odoo `parent_id` and `company_id` to their numeric
IDs; `companyName` holds the parent display name. Parent IDs remain source
references and link to copied parents in the UI when present. Source company
IDs are provenance, **never** local ownership. Notes, images, attachments,
custom fields and automatic synchronization are not imported.

Import requires confirmation and validates the whole batch before writing.
Identity is `(local company, Odoo origin, database, external ID)`, not email:
shared-email contacts remain separate. Existing identities are skipped without
overwriting local edits. On a storage interruption the API reports partial
counts; refresh and retry to skip already-created records safely. The import
API is `POST /api/contacts/import` with the above JSON plus `reviewed: true`.
`GET/POST /api/contacts` and versioned `PUT /api/contacts/{id}` share the existing
authentication and write-origin checks. Export JSON downloads local records
for reference; it is not an Odoo import-format round trip.
Website links gain an HTTPS scheme when absent; extra slashes after an HTTP(S)
scheme are normalized. The original source website is retained in Odoo
provenance and shown in contact details when different. Import reports include
the number of normalized website links.

The first release loads contacts for a small workspace without pagination.
Keep local development access private and back up the database.

## Configuration and access

| Variable | Purpose |
| --- | --- |
| `ODEE_ADDR` | Bind address; default `127.0.0.1:8098`. |
| `ODEE_ORIGIN` | Exact permitted write origin; defaults to the HTTP bind origin. |
| `ODEE_COMPANY_NAME` | Display name; default `My company`. |
| `ODEE_COMPANY_ID` | Stable nonzero BSON ObjectID used for both ownership axes. |
| `MONGODB_URI` | MongoDB connection string. Keep credentials out of Git. |
| `MONGODB_DATABASE_ODEE` | Dedicated database; default `odee`. |
| `ODEE_DOCUMENTS_DIR` | Optional absolute writable persistent directory for additional original copies; GridFS remains shared and authoritative. |
| `ODEE_DEV_MODE=true` | Explicit unauthenticated local mode; loopback bind only. |
| `ODEE_DEMO=true` | Temporary memory store; requires development mode. |
| `ODEE_AUTH_MODE` | `github` for team login; `token` (legacy default) for access-token/local development mode. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Server-side GitHub OAuth app credentials; required in GitHub mode. |
| `GITHUB_ORG`, `GITHUB_TEAM` | Required active team membership; organisation defaults to `uug-ai`. |
| `SESSION_SECRET` | Persistent Odee-specific signing key of at least 32 characters; required in GitHub mode. |
| `ODEE_API_TOKEN` | At least 32 characters; required in token mode outside development. Ignored in GitHub mode. |
| `ODEE_WEB_DIR` | Compiled frontend directory; default `web/dist`. |
| `ODEE_OCR_LANGUAGES` | Installed Tesseract language codes; default `eng+nld+fra`. |

### GitHub login (same access policy as Calendar)

Set `ODEE_AUTH_MODE=github` and `ODEE_DEV_MODE=false`. The example configuration
uses the `uug-ai/engineering` team. Only **active members of that team** can sign
in; organisation membership alone is not sufficient. Missing configuration,
unverifiable team membership, provider failures and pending memberships fail
closed. GitHub mode never accepts a company access token or development bypass.

Create a GitHub OAuth app with callback
`http://localhost:8098/auth/github/callback` for local use, or
`https://<your-odee-host>/auth/github/callback` for deployment. Keep `ODEE_ORIGIN`
equal to the browser's exact origin. Use a separate OAuth app for Odee if
Calendar's registered callback does not also permit this redirect; do not
change Calendar's callback to Odee's. Store credentials in ignored `.env.local`
or a secret manager, never in the frontend or Git. Generate an Odee-specific
`SESSION_SECRET` with `openssl rand -hex 32` and keep it stable across restarts.

The flow uses signed, ten-minute OAuth state and PKCE, then checks the signed-in
GitHub user's team membership server-side. The provider access token is used
only during login and is never persisted. Sessions last one hour in signed,
HttpOnly, SameSite=Lax cookies (`Secure` and `__Host-` scoped on HTTPS).
Cookies and signatures are separate from Calendar; logging in to one app does
not automatically log in to the other. Membership is rechecked at each login,
not on every request. Rotate the session key and restart to revoke all existing
sessions immediately. Sign out removes this browser's session; a copied signed
cookie remains valid until expiry or key rotation.

All workspace APIs, including contacts, uploads, previews and original PDFs,
require a valid session. Writes and logout additionally require the exact
origin and per-session CSRF token. `/api/session` exposes only login status and
access policy before login; the frontend does not fetch workspace data until
authenticated, and clears cached data/dialogs on logout or an expired session.
Use HTTPS outside loopback. The root `odee: run local` task loads `.env.local`,
uses the existing persistent local MongoDB and runs with GitHub authentication.
The Vite development proxy also forwards `/auth`; for OAuth use the configured
`ODEE_ORIGIN`, not a different development-server port.

All admitted team members currently have the same company-wide permissions.
GitHub identity is **not** an ownership ID and does not change the configured
MongoDB organisation/project scope. This is access control, not accounting
approvals or a complete role/permission system.

For legacy token mode, set `ODEE_AUTH_MODE=token`, disable `ODEE_DEV_MODE`, set a
cryptographically random `ODEE_API_TOKEN`, and use HTTPS. The token stays in tab
memory; rotate it and restart to revoke access. Unauthenticated development
mode remains explicitly opt-in and loopback-only. Do not expose it through a
public editor port forward.

## MongoDB model and invariants

Each invoice/bill is one document containing bounded `lines` (max 100),
`entries` (2–3), and `payments` (max 200; each embeds its two journal entries).
Partner details are a document snapshot. Accounts are the fixed starter chart.
Money uses BSON int64 cents; dates use ISO date strings; identifiers and
`organisationId` / `projectId` use BSON ObjectIDs.

Posting/payment changes update totals, status, and journals **together**, guarded
by document `version`. Retry after an uncertain network/storage result by
refreshing first: duplicate version/key submissions cannot duplicate a payment;
the API does not replay successful responses for idempotency keys.

Readers support legacy documents with a valid `ownerId` and absent canonical
ownership: both axes resolve to that owner immediately. Existing nonempty
canonical axes take precedence. Writers fill only missing axes. No backfill is
required for visibility, isolation, or edits.

## Verification

```sh
GOWORK=off go test -race ./...
GOWORK=off go vet ./...
cd web
npm test
npm run format:check
npm run build
npm run test:mongo
npx playwright install chromium
npm run test:scans
npm run test:e2e
```

`test:mongo` provisions a disposable local MongoDB binary via
mongodb-memory-server, runs persistence/reconnect, concurrent-update, tenant
isolation, and legacy-ownership tests, then shuts it down. It never consumes a
live database URI. GridFS tests cover original bytes, reconnects, scoped reads,
duplicate races, stale metadata writes, and runtime legacy ownership.
It also restarts the disposable MongoDB daemon and verifies that a bill and its
unchanged original survive on disk under the same stable company ID.
Filesystem tests additionally verify actual volume bytes alongside GridFS chunks,
atomic concurrent deduplication, checksum/path guards, legacy GridFS reads,
metadata updates, HTTP draft/download flows and separate-process restart
persistence of both filesystem originals and their MongoDB metadata.
The binary is downloaded on the first run. Linux ARM64 uses
MongoDB's Ubuntu 22.04 archive (requires libssl3), because MongoDB does not publish
a Debian ARM64 archive. The Go-only suite
skips that integration test when `ODEE_TEST_MONGODB_URI` is unset.

Browser tests use their own empty demo server on port 8099 and exercise
invoice/bill creation, draft editing, posting, rejected overpayment, partial/full
payments, trial balance export, refresh, and mobile keyboard interactions.
Import tests cover actual drag/drop, image batches, required review, duplicate
warnings, failed-scan manual drafts, previews and original downloads after
posting. `test:scans` generates synthetic PNG/JPEG/image-only and hybrid PDF
fixtures locally, and asserts actual OCR fields and exact integer totals. Poppler/Tesseract and
configured language packs are required. No real financial records are fixtures.
