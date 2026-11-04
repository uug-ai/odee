# Legal company and contact captures

The accounting workspace's **Legal company profile / Juridisch bedrijfsprofiel**
page stores one profile for the configured BSON company scope. This is separate
from the environment's display name, authenticated actor and imported Odoo
company IDs. Those values never establish ownership or historical legal identity.

## Metadata and validation scope

Contacts and the legal profile expose name/address, VAT, enterprise identifier,
bank account, BIC, free-text payment terms and tax applicability. Applicability
can be **unknown / not assessed** or **unsupported**; neither value certifies tax
eligibility, statutory invoice completeness, bank ownership or Peppol readiness.
Missing historical values are displayed as incomplete/unknown, never invented.

New or changed Belgian enterprise identifiers use ten digits and the modulo-97
check (last two digits = 97 minus the first eight digits modulo 97). Dots/spaces
are accepted without rewriting the saved spelling. Belgian VAT requires `BE`
and the same numeric check. Enterprise checking applies to country `BE`,
`Belgium`, `België`, `Belgique` or `Belgien`; a `BE` VAT prefix also selects the
Belgian check independently of country. A `BE` IBAN uses sixteen characters and
the ISO 13616 rearrangement/modulo-97 check. Spaces/case are ignored for the check
only. BIC syntax accepts 8 or 11 characters, not a directory lookup.

Sources for these **software checks**, not professional approval:

- [Microsoft's Belgian enterprise-number implementation documentation](https://learn.microsoft.com/en-us/dynamics365/business-central/localfunctionality/belgium/enterprise-numbers-and-branch-numbers),
  retrieved 2026-11-04 (ten digits/modulo 97).
- [Belgian IBAN structure reference](https://www.ecbs.org/iban/belgium-bank-account-number.html),
  retrieved 2026-11-04 (16-character structure and `BE68539007547034` example);
  ISO 13616/ISO 7064 MOD 97-10 is the checksum algorithm, not a bank verification.
- The accepted roadmap's pinned Odoo 20.0 Belgium/contact references remain the
  capability comparison, not a claim that ODEE supplies those statutory modules.

Other countries' identifier validity is unassessed. No provider/registry lookup
or payment is made. Imported/historical identifiers are retained verbatim:
unrelated edits and contact capture do not retroactively reject an unchanged
identifier under the new checks. Existing unknown applicability values display
as unassessed and are retained unless explicitly changed. Payment terms are
metadata only: they do not recalculate due dates or financial amounts.
Contact edits from older clients that omit the new metadata retain its stored
values; an explicit empty string clears an editable value.

## API and capability boundary

| Route / operation                                                           | Explicit capabilities |
| --------------------------------------------------------------------------- | --------------------- |
| `GET /api/company-profile` (profile or `null`), profile in `GET /api/state` | `read`                |
| `PUT /api/company-profile` with `{version, data}`                           | `read` + `admin`      |
| Contact create/edit/archive, draft create/edit/review conversion            | `read` + `write`      |
| Post / manual payment                                                       | `read` + `post`       |

Version `0` creates the singleton profile; later mutations require its current
version. Concurrent creation/edit returns 409. No capability implies another.
Compatibility mode still grants no admin. Initial real administrator grants
and enforced live rollout remain human-controlled; no automatic administrator
or production configuration is added. 403 stays signed in and never retries.

Draft requests retain all existing manual fields. An explicit saved selection
adds `partnerAction: "select"`, `contactId`, `expectedContactVersion`. An explicit
refresh adds `partnerAction: "refresh"` with the captured contact ID and the
observed current contact version. Updates also require the **document** `version`.
Missing/malformed inputs are rejected; an observed source version mismatch is
409 independently of a stale document version. Foreign or archived sources
cannot be selected/refreshed. Client `partnerSnapshot`/`ownCompanySnapshot`
objects are rejected, not trusted.

The server reads the active scoped contact and captures its complete accounting
data, stable ObjectID, source version and snapshot schema version `1`. Capture
is a copy of the contact version read, **not a cross-document transaction or
lock**. A concurrent contact edit after resolution may coexist with that
complete older capture. No current-source lookup occurs during ordinary document
save, read, post or payment.

Captured partner name/email are read-only until explicit reselection or
`partnerAction: "manual"`. Manual conversion preserves the captured metadata,
removes the contact reference/source version and permits manual name/email
edits; it does not pretend the result is still a saved contact. In stored/manual
captures a zero ObjectID means no reference. Failed refresh leaves all document
fields/version/history unchanged. Pending selection/refresh/conversion in the
dialog applies only on **Save draft**; cancel performs no write.

Creation (including bill review-to-draft) captures the configured own-company
profile: invoice `seller`, bill `buyer`. Existing drafts can explicitly request
`ownCompanyAction: "refresh"` plus the observed `expectedCompanyVersion`, as well
as their document version. Posting freezes the **persisted** capture, not the
latest profile. Subsequent contact/profile edits or archive never rewrite posted
captures. Missing profile / legacy no-snapshot documents remain readable,
editable as drafts, postable and payable under unchanged financial rules.

Mongo stores `company_profiles` and document captures with canonical ObjectID
axes. Each missing/null/zero canonical axis independently falls back to stable
valid `ownerId`; a nonempty foreign canonical axis always wins, even if owner
matches. No migration is needed. Financial mutation, version increment and
existing audit append remain in one scoped/versioned document update on
standalone MongoDB. Settings/contact edits do not broaden financial audit.

## Focused self-validation

Normal `npm --prefix web run test:e2e -- company.spec.ts` discovers one parent
adapter, without `ODEE_COMPANY_TEST_*` opt-in. The adapter launches the protected
disposable fixture with `--browser-only`: two EN/NL lifecycle children plus ten
destination-guard children, then one read-only child covering both locales.
All thirteen children must execute and pass; skipped/missing children or a
nonzero child process fail the parent. The fixture bodies live in
`company.fixture.ts`, selected only by `company.config.ts`; the child cannot
recursively select the parent adapter. The ordinary CI browser selection
therefore enforces the company journeys, rather than silently skipping them.

Run `node web/tests/company.mjs` after the production frontend build for the
additional full Go diagnostic. Both entry paths create
a sanitized unique environment, disposable MongoDB 8.0.16 standalone, owned
loopback port, synthetic token/grants and guarded Chromium/API contexts. Each runs
the app build, ten permanent destination-guard tests, protected EN/NL
browser lifecycles, raw stored snapshot assertions and an actual application
stop/restart comparison. Evidence is retained in the printed ignored
`.local-data/odee007/<run>/` path; bounded child termination is awaited, MongoDB
is stopped, and owned databases/caches are removed on exit. Only the diagnostic
without `--browser-only` additionally runs the full package Go race tests/vet.
Child browser artifacts use the owned fixture scratch, not the normal parent's
output directory, so child startup cannot erase parent failure evidence.

Normal `npm --prefix web run test:mongo` also provisions an isolated disposable
MongoDB and executes `^(TestMongo|TestSnapshot|TestCompanyProfile|TestReview)`.
It verifies passing JSON test events for the historical Mongo tests and the
required persistent snapshot/profile/review branches, rejecting unexpected
fixture skips. The matrix also requires the shared-GridFS/volume-copy regression.
It explicitly skips only `TestMongoDiskPersistence` and
`TestMongoDocumentVolumeDiskPersistence` because these require a phase; the runner
then requires **both** tests' real `write` and `read` passes on either side of an
actual MongoDB daemon disk restart. The owned originals directory is retained
through both phases. Missing or skipped disk fixtures fail the result gate.
JSON events and a selected-case summary remain under the printed ignored
`.local-data/mongo/<run>/` path. No inherited application/database credentials
or caller database URI are used.

Go selectors: `TestSnapshotLifecycleMemory`, `TestSnapshotLifecycleMongo`,
`TestCompanyProfilePermissionsAndValidation`, `TestSnapshotCanonicalAndLegacyScope`,
`TestSnapshotReadVersionNotCrossDocumentLock`,
`TestCompanyProfileLegacyScopeAndConflicts`, `TestReviewDraftCapturesCompanyAndPartner`
and `TestReviewRetryRejectsForeignCanonicalDocument`. Mongo-dependent selectors skip
without `ODEE_TEST_MONGODB_URI`; a skip is not Mongo validation. The historical
broad browser launcher still requires its separately disclosed owned launch-only
guard; this feature runner does not claim to repair that launcher. For safe
normal-selector verification, a launch-only config overlay may import the
committed normal config and disable only its historical `webServer`; keep its
normal test selection, bodies and environment defaults unchanged. The company
adapter and all its children protect their own HTTP destinations independently
of that overlay.
The runner also restarts with a synthetic read-only grant and proves EN/NL
disabled settings, HTTP 403, retained authenticated session and zero state changes.
