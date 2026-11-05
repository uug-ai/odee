# Peppol provider discovery and offline adapter contract

ODEE-013, specification revision 2. Research update: 2026-11-05.
Status: documentation candidate; no provider selection, account, credentials,
registration, commercial commitment or network-send authorization.

This is an original summary of public documentation, not a tested integration
or a compliance opinion. Unknowns block only the dependent integration claims.
ODEE-014 must separately pin and test applicable validation artifacts.
Unverified provider evidence does not block unrelated safe finance work.

## Public-source comparison

The [OpenPeppol member directory](https://peppol.org/members/full-members-list/)
lists Billit, Storecove/Datajust and Qvalia with Access Point roles. A membership
listing alone is not proof of current certification or accreditation. The
separate [certified-provider directory](https://peppol.org/members/peppol-certified-service-providers/)
was checked on 2026-11-03. A refresh was attempted on 2026-11-05, but public
documentation hosts could not be resolved from this research environment.
Accordingly, the directory entries below are a dated snapshot, not a claim of
current certification; recheck the exact contracting entity before selection.

| Candidate legal entity | AP certified listing | SMP certified listing |
| --- | --- | --- |
| Billit BVBA, Belgium | Listed | Listed |
| Datajust B.V. (Storecove), Netherlands | Listed | Listed |
| Qvalia AB, Sweden | Listed | Listed |
| Storecove Belgium | Separate entry not established | Separate entry not established |

This is a mutable registry snapshot, not permanent accreditation or approval
of a contract. The 2026-11-05 refresh is unverified. Verify the exact
contracting entity again before selection; do not transfer the Dutch entity's
certification to the Belgian entity.

| Question | Billit | Storecove / Storecove Belgium | Qvalia |
| --- | --- | --- | --- |
| Test environment | Separate sandbox endpoints and credentials; registration required ([environment guide](https://docs.accesspoint.billit.eu/docs/sandbox-vs-production.md)); 2026-11-05 access check unverified | Test-account path described in the vendor FAQ; account access, duration and production parity unverified ([FAQ](https://www.storecove.com/us/en/mystorecove/faq/)) | Test API described in developer materials; account activation and production parity unverified ([developer tools](https://qvalia.com/api-developer-tools/)) |
| Outbound invoice / credit note | Invoice and credit-note operations described in the [API documentation](https://docs.accesspoint.billit.eu/llms.txt); exact profile coverage needs confirmation | Invoice submission documented in the [submission example](https://help.storecove.com/en/articles/4640597-submit-invoices-via-the-api); credit-note schema/support unverified | Invoice and credit-note APIs described in the [developer documentation](https://api.qvalia.io/); exact profile coverage needs confirmation |
| Inbound access | Participant lookup, inbound notifications and file references described ([participant lookup](https://docs.accesspoint.billit.eu/docs/who-is-a-invoice-receiver.md), [webhooks](https://docs.accesspoint.billit.eu/docs/webhooks.md), [files](https://docs.accesspoint.billit.eu/docs/get-files.md)); enrollment and retrieval limits unverified | Inbound notification described in vendor material; exact public retrieval contract unverified ([API reference](https://www.storecove.com/docs/#_storecove_api_reference)) | Incoming-document events described; exact retrieval and original-byte contract unverified ([developer tools](https://api.qvalia.io/)) |
| Payload / originals | UBL/XML and attachments described; file retrieval is documented, while byte-exact transport originals and delivery-evidence availability need confirmation ([files](https://docs.accesspoint.billit.eu/docs/get-files.md)) | JSON submission documented; original transported XML retrieval unverified ([submission example](https://help.storecove.com/en/articles/4640597-submit-invoices-via-the-api)) | JSON/XML representations described; byte-exact transported-original retrieval unverified ([developer tools](https://api.qvalia.io/)) |
| Authentication | API key and account/party context; entity identification required ([authentication](https://docs.accesspoint.billit.eu/docs/authentication.md), [identification](https://docs.accesspoint.billit.eu/docs/identification.md)); recheck current credential scopes | Authorization/API-key example referenced by vendor documentation; exact scope lifecycle and sandbox/production separation unverified ([API reference](https://www.storecove.com/docs/#_storecove_api_reference)) | API key and token option described; credential lifecycle and environment separation unverified ([developer documentation](https://api.qvalia.io/)) |
| Request idempotency | No explicit request-idempotency guarantee found in the 2026-11-03 review; current behavior unverified | Not established by the pages reviewed | Not established by the pages reviewed |
| Reconciliation / unknown send | Document lookup and delivery-status fields described ([status](https://docs.accesspoint.billit.eu/docs/get-status-of-a-sales-invoice.md)); whether a timeout can be resolved safely or retried is unverified | Submission GUID and status lookup described; safe recovery after a lost response is unverified ([submission example](https://help.storecove.com/en/articles/4640597-submit-invoices-via-the-api)) | Polling/notifications described; authoritative lookup and unknown-send semantics unverified ([developer documentation](https://api.qvalia.io/)) |
| Callback verification | Secret/signature mechanism described; implement only its exact current specification ([webhooks](https://docs.accesspoint.billit.eu/docs/webhooks.md)) | Signature/replay contract unverified | Signature/replay contract unverified |
| Rate limits / retry guarantees | Unverified | Unverified | Unverified |
| Commercial prerequisites | Price, service levels, residency, retention and DPA terms unverified; obtain written terms before selection | Price, service levels, residency, retention and DPA terms unverified; FAQ or marketing is not a contract | Price, service levels, residency, retention and DPA terms unverified |

This comparison preserves the 2026-11-03 public-source review and adds exact
primary-source pointers. On 2026-11-05, direct retrieval of OpenPeppol, Billit,
Storecove and Qvalia documentation failed at DNS resolution. Search-index
snippets were used only to discover candidate source URLs, not to upgrade any
capability or guarantee. Cells marked unverified therefore remain open
questions, not evidence that a provider lacks the feature. No test accounts,
credentials or provider endpoints were used.

In the 2026-11-03 snapshot, Billit had the most concrete retrieved public
file/status/callback documentation for an initial technical spike. The
2026-11-05 refresh does not rank or approve a provider. Obtain contractual
answers about duplicate suppression, unknown outcomes, original retrieval,
data processing, retention, support and total cost first. No signup or sandbox
invocation is implicitly authorized by this comparison.

### Sources

- The following public pages were reviewed for the dated 2026-11-03 snapshot;
  direct refresh on 2026-11-05 was unavailable as noted above.
  The provider pages did not expose a versioned immutable snapshot identifier
  in the reviewed evidence; the URLs are mutable.
- OpenPeppol [full members list](https://peppol.org/members/full-members-list/)
  and [certified service providers](https://peppol.org/members/peppol-certified-service-providers/).
- Billit [documentation index](https://docs.accesspoint.billit.eu/llms.txt),
  [environments](https://docs.accesspoint.billit.eu/docs/sandbox-vs-production.md),
  [authentication](https://docs.accesspoint.billit.eu/docs/authentication.md),
  [entity identification](https://docs.accesspoint.billit.eu/docs/identification.md).
- Billit [participant lookup](https://docs.accesspoint.billit.eu/docs/who-is-a-invoice-receiver.md),
  [files](https://docs.accesspoint.billit.eu/docs/get-files.md),
  [delivery status](https://docs.accesspoint.billit.eu/docs/get-status-of-a-sales-invoice.md),
  [callbacks](https://docs.accesspoint.billit.eu/docs/webhooks.md),
  [invoice responses](https://docs.accesspoint.billit.eu/docs/imr-more-information.md).
- Storecove [submission example](https://help.storecove.com/en/articles/4640597-submit-invoices-via-the-api)
  and [official FAQ](https://www.storecove.com/us/en/mystorecove/faq/);
  its [API reference](https://www.storecove.com/docs/#_storecove_api_reference)
  remains subject to access and version confirmation.
- Qvalia [developer tools](https://qvalia.com/api-developer-tools/),
  [developer portal](https://api.qvalia.io/),
  [quick start](https://api.qvalia.io/quick-start) and
  [transaction API](https://api.qvalia.io/api-documentation/apis/transaction-api),
  [API onboarding](https://qvalia.com/help/how-to-access-peppol-api-step-by-step-guide/)
  and [message-level status](https://qvalia.com/help/what-is-peppol-message-level-status-mls/).
- Primary Peppol specifications distinguish
  [Message Level Response T71](https://docs.peppol.eu/poacc/upgrade-3/syntax/MLR/tree/)
  from [Invoice Response T111](https://docs.peppol.eu/poacc/upgrade-3/syntax/InvoiceResponse/tree/).
  Sharing an ApplicationResponse XML type does not make their meanings identical.
  Exact MLS transition dates remain unverified here and are not release criteria.

These are mutable sources. "Unverified" means the bounded public research did
not establish the claim, not that the provider lacks the capability. Do not
infer certification, production behavior, service levels or legal compliance
from a marketing claim, directory membership or successful mock.

## Provider-neutral contract

### Scope and identity

- Resolve the existing BSON ObjectID organisation/project ownership at runtime,
  including legacy owner fallback. Actor, imported company and provider account
  IDs do not become tenant ownership.
- A participant is a scheme plus identifier, not an untyped string. Preserve
  original identifiers and validate/normalize with a versioned scheme policy.
  Public examples use Belgian enterprise scheme `0208`; confirm eligibility
  and the current code list before any registration.
- Bind a submission to canonical scope, local document ID, immutable document
  revision, document kind, participants and the byte-exact payload hash.
- Credentials and provider-account mappings are scoped configuration references.
  Never place secrets or real customer XML in fixtures, logs or callback URLs.

### Operations and durable results

The adapter exposes participant discovery, submission, lookup/reconciliation,
authenticated-notification intake and original-document retrieval. The first
implementation is an offline mock; live transport is disabled by default.

| Operation | Required input | Normalized result |
| --- | --- | --- |
| Discover participant | Canonical scope and scheme/identifier pair | Registration and supported document types with observation time/evidence; unavailable discovery is an error, not "unregistered" |
| Submit | Prepared immutable document, participants, bytes/hash and stable local key | Accepted provider reference, already-known identical submission, or explicit error/unknown outcome |
| Poll / reconcile | Canonical scope and known local attempt reference | Separate transport/technical/business observations with provider codes, time and evidence; retain the exact raw response; never a payment mutation |
| Ingest notification | Configured provider-account reference, headers and original request bytes | Durable accepted/duplicate acknowledgement, retained quarantine or explicit rejection; route outbound observations to a known submission and first inbound documents to admission |
| Admit inbound | Authenticated account/receiver evidence, provider document ID, kind, original reference and exact bytes/hash | One scoped original receipt, duplicate acknowledgement or explicit quarantine/conflict; no outgoing submission is required |
| Retrieve original | Canonical scope and known document/message reference | Exact bytes, MIME type, hash and provenance, or an explicit unavailable-original error |

Local references are resolved inside their scope before provider access.
Document validation includes kind, participants and the pinned format/profile,
not only XML well-formedness. Notifications receive a success acknowledgement
only after their verified event is durably retained; duplicate handling must
not cause another transition.

Normalized errors distinguish `VALIDATION_FAILED`, `PAYLOAD_CONFLICT`,
`PARTICIPANT_LOOKUP_UNAVAILABLE`, `PROVIDER_LIMITED`, `SEND_OUTCOME_UNKNOWN`,
`NOTIFICATION_UNVERIFIED`, `ORIGINAL_UNAVAILABLE` and `SCOPE_MISMATCH`.
Retry safety is explicit; a retry delay is reported only when supported by
provider evidence. None is translated into a successful submission or a
settled financial document.

The offline contract also uses `INVALID_INPUT`, `IDEMPOTENCY_CONFLICT`,
`INBOUND_CONTENT_CONFLICT`, `EVENT_CONFLICT` and `EVENT_CAPACITY_EXCEEDED`.
Every mock error has `outcome`, `code`, `retrySafe`, `attemptId` and
`financialMutation`; `attemptId` is null unless a same-scope attempt is known.
Mock errors use `retrySafe: false` conservatively. This is not a provider retry
policy; production mappings need documented operation-specific evidence.

1. **Prepare:** validate scope, participants and document revision; preserve
   exact original bytes and their hash before submission. Link outgoing bytes
   to an immutable financial snapshot. A validation failure is explicit.
2. **Submit:** persist the intended attempt before invoking transport. A stable
   local idempotency key deduplicates ODEE requests for the same payload.
   Reusing that key with different bytes is a conflict, not a silent update.
3. **Reconcile:** retain provider submission/message references and look up the
   authoritative result when supported. A timeout after a possible remote
   acceptance is an **unknown outcome**, not proof of failure.
4. **Notify:** authenticate the raw callback according to the provider contract,
   enforce size/replay/deduplication controls and validate scope. Outbound
   observations must correlate a known submission; first inbound documents use
   the admission path below instead. An unverifiable callback cannot change
   business state. Use authenticated polling when callback trust cannot be
   established.
5. **Retrieve:** retain the exact XML and attachments actually received, with
   hashes and provenance. Reconstructed XML from provider JSON is not the
   transported original. Missing-original support is an explicit integration
   gap, not permission to claim archival compatibility.

Local keys alone do not guarantee exactly-once external delivery. After an
uncertain send, do not blindly retry unless documented provider idempotency or
reconciliation establishes safety. Otherwise retain `unknown`, surface an
operator action and require an explicit resolution. Poll failures preserve the
last known delivery evidence rather than declaring a delivered invoice failed.

### First inbound admission

1. Before enabling intake, explicitly configure one canonical scope and its
   allowed receiver participants for each authenticated account binding.
   Resolve legacy ownership using the existing runtime rules, preserving every
   nonempty canonical axis. An unknown, ambiguous or disabled account binding
   fails with `SCOPE_MISMATCH` before business-document access. XML content,
   sender, supplier, actor and callback-supplied scope fields cannot establish
   ownership or select another binding.
2. Authenticate the notification or polling response against that binding.
   A first inbound envelope supplies `subjectType: "inbound"`,
   `providerDocumentId`, `kind`, `receiver` and `originalRef`. Its receiver must
   match the binding's allowlist using authenticated provider evidence, not
   just a receiver copied from XML. Resolve originals only through the bound
   provider client; never fetch an arbitrary callback-supplied URL.
3. Before acknowledging receipt, durably retain the original bytes, SHA-256,
   authenticated provenance and receipt keyed by
   `(canonical scope, account reference, provider document ID)`. No outgoing
   submission or supplier match is needed. Identical repeats, including
   different notification IDs and concurrent delivery, return the existing
   receipt without creating another original or business document.
4. Reusing that receipt identity with changed bytes, kind or receiver is
   `INBOUND_CONTENT_CONFLICT`: preserve the first original, quarantine the
   conflicting evidence and leave business records unchanged. A validly
   authenticated but unexpected receiver, invalid/unsupported XML or ambiguous
   supplier match is quarantined inside the configured scope with a reason;
   never infer another scope or silently repair the payload.
5. A positive offline fixture produces one receipt in `awaiting_review`;
   invalid content produces `quarantined` with `VALIDATION_FAILED`. These are
   intake states, not bills. ODEE-016 owns supplier resolution and the later
   replay-safe review-to-draft transition. No admission posts or pays anything.

An acknowledged event remains recoverable if processing stops before its
projection is applied: retain pending processing explicitly and replay it
idempotently after restart. A failed durable write is an error, not an accepted
acknowledgement. Conflicts/quarantine must remain visible to authorized review.

### Separate state axes

- **Transport:** not submitted, queued, provider accepted, in transit, delivered,
  failed or unknown. Each transition needs documented provider evidence.
  A false "delivered" boolean alone does not establish a terminal failure.
- **Technical acknowledgement:** preserve the message type, specification and
  evidence separately. Do not treat an MLR or transport-level message as buyer
  acceptance of the invoice.
- **Business response:** none, acknowledged, accepted, rejected, in process,
  under query, conditional or unknown, where the applicable response format
  supports it. Preserve unsupported codes explicitly rather than guessing.
- **Accounting/payment:** remains ODEE's independently authorized ledger state.
  A provider "paid" report is informational; it does not post, pay, reconcile,
  reverse or otherwise mutate a financial document.

Handle duplicate, late and out-of-order notifications. Retain bounded,
paginated audit events with provenance and raw-code references; do not grow an
unbounded embedded status-history array. Logs contain safe metadata, not XML,
authentication headers or account secrets.

### Deterministic offline notification policy

These are synthetic mock rules, not claims about any provider's protocol or
production/legally required retention limits. Real adapters must document their
own verified authentication, ordering and capacity policy before enablement.

- Use the configured `mock-account-001` binding, not a caller-selected tenant.
  Require `X-ODEE-Mock-Event-ID`, `X-ODEE-Mock-Timestamp` (canonical decimal Unix
  seconds) and `X-ODEE-Mock-Signature` (64 lowercase hexadecimal characters).
  The signature is HMAC-SHA256 with the explicitly synthetic key
  `odee-offline-test-key-not-a-credential` over
  `accountRef + LF + timestamp + LF + eventId + LF + originalRequestBytes`.
  Verify before JSON parsing, using constant-time digest comparison.
  Never use this known test key for a real provider or network-enabled adapter.
- The fixed test clock is `2026-11-03T00:00:00Z` (`1793664000` seconds).
  Accept a timestamp at most 300 seconds before/after that clock, inclusive;
  missing, malformed, stale, future or incorrect authentication is
  `NOTIFICATION_UNVERIFIED` and cannot mutate state.
- Deduplicate by `(accountRef, eventId)` after authentication. The same key and
  exact body hash returns `duplicate` without another retained event or state
  transition. A validly re-signed retry may use a fresh timestamp. The same key
  with different body bytes is `EVENT_CONFLICT`, never an overwrite.
- Outbound bodies identify `subjectType: "outbound"` and a
  `providerSubmissionId` already bound to this account and scope. Unknown
  outbound references are quarantined as unmatched evidence, not treated as
  first inbound documents. Inbound bodies use the admission fields above.
  Canonical-scope override fields are invalid input, not ownership hints.
- Each supplied state axis carries the body's positive integer
  `providerRevision`; track the latest revision separately per axis. Lower
  revisions are retained as stale without changing that axis; equal revision
  and equal value is a no-op; equal revision and different value is a conflict
  requiring reconciliation. Do not use arrival time as provider ordering.
- Higher transport revisions may skip forward through queued, provider
  accepted, in transit and delivered when supported by evidence; only a
  conclusive failure code establishes failed. Delivered/failed are terminal:
  a regression or contradictory terminal observation is retained as a
  conflict without changing the projection. Resolve it through explicit
  authoritative reconciliation. Higher business-response revisions are
  observations on that separate axis, never ledger instructions. Validate
  all supplied axes before projection; a conflicting event changes none.
  Unordered real-provider observations cannot borrow mock revisions: retain
  them unapplied and reconcile rather than inventing an arrival-order rule.
- Mock callback bodies are limited to 65,536 bytes, original fixtures to
  1,048,576 bytes, and distinct retained events to 200 per attempt/receipt.
  Duplicates consume no additional event slots. Overflow returns an explicit
  size error or `EVENT_CAPACITY_EXCEEDED`, with no success acknowledgement,
  silent drop, projection change or automatic deletion. Surface operator
  action/backpressure. Retain events separately, not in an unbounded embedded
  history. History pages default to 25 and accept integers 1 through 100;
  invalid sizes/cursors are `INVALID_INPUT`. Cursors bind scope and subject,
  and order by durable admission ordinal, not provider revision.

### Synthetic mock examples

These describe the adapter boundary, not a provider API or proof of valid UBL.
The following defines fixture policy `offline-fixture-v1`: only these exact
positive byte fixtures pass its deliberately artificial validation. They are
not UBL and must never pass the production validator or reach a real adapter.
ODEE-014 supplies actual version-pinned valid/invalid XML; no example authorizes
a network call.

Both positive fixtures use sender `{scheme: "mock", identifier: "sender-001"}`
and receiver `{scheme: "mock", identifier: "receiver-001"}`.
`mock-account-001` explicitly binds the scope in the request below and allows
that receiver. The `mock` scheme is offline-only, not a Peppol registration.
Each positive body below has exactly one trailing LF; the invalid body has none.

| Fixture | Kind / local document | Exact UTF-8 body before trailing LF |
| --- | --- | --- |
| `mock-valid-invoice-v1` | `invoice` / `synthetic-invoice-001`, revision 1 | `<MockInvoice id="synthetic-invoice-001"/>` |
| `mock-valid-credit-note-v1` | `credit_note` / `synthetic-credit-001`, revision 1 | `<MockCreditNote id="synthetic-credit-001"/>` |
| `mock-invalid-xml-v1` | Invalid, never prepared | `<broken` |

Expected SHA-256 values, including the LF where specified:

- Invoice: `5335e4db75babe95487747946ecfef93781e2be86c9f93eaf258512b58621035`
  (42 bytes).
- Credit note: `0c2a247d8d76b9205d7355199a32db246b71485f1f5ce348cdd07731a3c049e9`
  (44 bytes).
- Invalid: `b76cd21f24358c3778f41dd68d27a0a9307241769074000c90fa8686ad5616d6`
  (7 bytes).

The configured normal scenario yields the following send request/result.

```json
{
  "operation": "submit",
  "scope": {
    "organisationId": "000000000000000000000001",
    "projectId": "000000000000000000000001"
  },
  "documentId": "synthetic-invoice-001",
  "documentRevision": 1,
  "kind": "invoice",
  "payloadFixture": "mock-valid-invoice-v1",
  "idempotencyKey": "synthetic-scope:synthetic-invoice-001:v1"
}
```

```json
{
  "outcome": "provider_accepted",
  "attemptId": "mock-attempt-001",
  "providerSubmissionId": "mock-submission-001",
  "transport": "provider_accepted",
  "businessResponse": "none",
  "financialMutation": false
}
```

Resolve `payloadFixture` to the exact bytes/metadata above, verify its hash and
bind scope, document/revision, kind and participants to the durable intent.
An identical repeat returns the identical accepted result, with no additional
attempt or provider invocation. A changed binding under the same scoped key
returns the error below, preserving the original attempt.

A poll of the attempt returns a separate transport observation. This
deterministic fixture uses `provider_accepted`; it does not imply delivery or
business acceptance.

```json
{
  "operation": "poll",
  "attemptId": "mock-attempt-001"
}
```

```json
{
  "outcome": "observed",
  "attemptId": "mock-attempt-001",
  "transport": "provider_accepted",
  "businessResponse": "none",
  "source": "mock-poll",
  "financialMutation": false
}
```

```json
{
  "outcome": "error",
  "code": "IDEMPOTENCY_CONFLICT",
  "retrySafe": false,
  "attemptId": "mock-attempt-001",
  "financialMutation": false
}
```

In a fresh mock instance configured with `accepted-response-lost`, the same
request durably records the intent, simulates remote acceptance, then returns:

```json
{
  "outcome": "unknown",
  "code": "SEND_OUTCOME_UNKNOWN",
  "retrySafe": false,
  "attemptId": "mock-attempt-001",
  "providerSubmissionId": null,
  "transport": "unknown",
  "businessResponse": "none",
  "financialMutation": false
}
```

Repeating that request, including after restart, returns the same unknown
result without another send. A new key for the same unresolved immutable
snapshot also resolves to that existing intent, not another transport attempt.
Reconciliation by `mock-attempt-001` finds `mock-submission-001` and returns
the normal accepted result above. This is a mock scenario, not an external
exactly-once guarantee.

For a reproducible outbound callback, use event ID `mock-event-001`, timestamp
`1793664000` and this exact UTF-8 body (no trailing LF):
`{"subjectType":"outbound","providerSubmissionId":"mock-submission-001","providerRevision":1,"transport":"delivered"}`.
Its signature under the policy above is
`3742866e293e66b560cf8d019d5bf0977d81d6b3f485e1b97d4329f2f967e322`.
Retain those exact 116 request bytes before acknowledging, together with the
content type, SHA-256
`1c6b1035bf004efa833da3cda6a6aa546e8ee982ea9a645854dfdb9b475ca396`,
account reference, event ID, authentication result and durable receipt. The
verified event advances transport only; an identical retry is a duplicate.

```json
{
  "outcome": "accepted",
  "eventId": "mock-event-001",
  "duplicate": false,
  "retainedRawPayload": {
    "mediaType": "application/json",
    "byteLength": 116,
    "sha256": "1c6b1035bf004efa833da3cda6a6aa546e8ee982ea9a645854dfdb9b475ca396"
  },
  "transport": "delivered",
  "financialMutation": false
}
```

Replaying the exact authenticated event returns the existing receipt with
`"duplicate": true`; it does not add another event or state transition. The
raw-payload metadata is a reference to retained bytes, not a decoded and
re-serialized replacement.

A first inbound fixture uses the same bound account, a new signed event ID,
`subjectType: "inbound"`, `providerDocumentId: "mock-inbound-001"`,
`kind: "invoice"`, the allowed mock receiver and
`originalRef: "mock-valid-invoice-v1"`. It yields one `awaiting_review` receipt
with that provider document ID and the invoice hash above, with no submission,
bill or payment. Replaying under another event ID still yields that one receipt.
Substituting `mock-invalid-xml-v1` for a new inbound document yields a retained
`quarantined` receipt with `VALIDATION_FAILED`; substituting changed content
under the original document ID yields `INBOUND_CONTENT_CONFLICT`.

### Independent acceptance scenarios

- Invoice and credit-note round trips preserve original bytes and ownership.
- Repeated same-key submissions, conflicting payloads and concurrent workers
  have deterministic explicit results.
- Simulated acceptance followed by a lost response causes no blind resend;
  supported reconciliation finds the existing submission.
- Forged, duplicate, replayed, late, cross-scope and out-of-order notifications
  cannot manufacture delivery, business acceptance or financial settlement.
- Unknown/malformed inbound XML and ambiguous supplier matches are quarantined;
  neither automatic posting nor payment is possible.
- Missing originals, unavailable discovery/status, validation errors and limits
  remain visible errors or blocked capabilities, never success-shaped defaults.
- Mock processes use synthetic credentials, disposable data and no provider
  network access. Human approval is required for every later onboarding/send
  boundary described above.
