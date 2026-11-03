# Peppol provider discovery and offline adapter contract

ODEE-013, specification revision 1. Research date: 2026-11-03.
Status: documentation candidate; no provider selection, account, credentials,
registration, commercial commitment or network-send authorization.

This is an original summary of public documentation, not a tested integration
or a compliance opinion. Unknowns block only the dependent integration claims.
ODEE-014 must separately pin and test applicable validation artifacts.

## Public-source comparison

The [OpenPeppol member directory](https://peppol.org/members/full-members-list/)
lists Billit, Storecove/Datajust and Qvalia with Access Point roles. A membership
listing alone is not proof of current certification or accreditation. The
separate [certified-provider directory](https://peppol.org/members/peppol-certified-service-providers/)
was checked on 2026-11-03:

| Candidate legal entity | AP certified listing | SMP certified listing |
| --- | --- | --- |
| Billit BVBA, Belgium | Listed | Listed |
| Datajust B.V. (Storecove), Netherlands | Listed | Listed |
| Qvalia AB, Sweden | Listed | Listed |
| Storecove Belgium | Separate entry not established | Separate entry not established |

This is a mutable registry snapshot, not permanent accreditation or approval
of a contract. Verify the exact contracting entity again before selection;
do not transfer the Dutch entity's certification to the Belgian entity.

| Question | Billit | Storecove / Storecove Belgium | Qvalia |
| --- | --- | --- | --- |
| Test environment | Separate sandbox endpoints and credentials; registration required | Test account offered; access and duration need confirmation | Separate test API and credentials; account/onboarding required |
| Outbound invoice / credit note | Both described in the Order API | Invoice submission documented; credit-note support described, exact schema unverified | Both explicitly listed in the Invoicing API |
| Inbound access | Purchase documents, notifications and file references described | Inbound notification described; exact retrieval contract unverified | Incoming-document events described; exact retrieval contract needs verification |
| Payload / originals | UBL/XML and attachments retrievable through file references; delivery-evidence file is reportedly UI-only | JSON submission documented; original transported XML retrieval unverified | JSON/XML representation described; byte-exact transported-original retrieval unverified |
| Authentication | API key and account/party context; entity identification required | Authorization/API-key example; exact scope lifecycle unverified | API key and documented token option; separate environments |
| Request idempotency | Not established by the pages reviewed | Not established by the pages reviewed | Not established by the pages reviewed |
| Reconciliation | Document lookup/listing and delivery-status fields documented | Submission GUID and status lookup described | Polling or notifications described; exact lookup contract unverified |
| Callback verification | Secret/signature mechanism documented; implement its exact specification | Signature/replay contract unverified | Signature/replay contract unverified |
| Rate limits / retry guarantees | Unverified | Unverified | Unverified |
| Residency / retention / price | Unverified | Unverified; incorporation or archive marketing is not a residency guarantee | Unverified |

Billit currently has the most concrete retrieved public file/status/callback
documentation for an initial technical spike. This is not a provider approval.
Obtain contractual answers about duplicate suppression, unknown outcomes,
original retrieval, data processing, retention, support and total cost first.
No signup or sandbox invocation is implicitly authorized by this comparison.

### Sources

- [Billit documentation index](https://docs.accesspoint.billit.eu/llms.txt),
  [environments](https://docs.accesspoint.billit.eu/docs/sandbox-vs-production.md),
  [authentication](https://docs.accesspoint.billit.eu/docs/authentication.md),
  [entity identification](https://docs.accesspoint.billit.eu/docs/identification.md).
- Billit [participant lookup](https://docs.accesspoint.billit.eu/docs/who-is-a-invoice-receiver.md),
  [files](https://docs.accesspoint.billit.eu/docs/get-files.md),
  [delivery status](https://docs.accesspoint.billit.eu/docs/get-status-of-a-sales-invoice.md),
  [callbacks](https://docs.accesspoint.billit.eu/docs/webhooks.md),
  [invoice responses](https://docs.accesspoint.billit.eu/docs/imr-more-information.md).
- Storecove [submission example](https://help.storecove.com/en/articles/4640597-submit-invoices-via-the-api)
  and [official FAQ](https://www.storecove.com/us/en/mystorecove/faq/).
- Qvalia [developer tools](https://qvalia.com/api-developer-tools/),
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
| Reconcile | Canonical scope and known local attempt reference | Separate transport/technical/business observations with provider codes, time and evidence; never a payment mutation |
| Ingest notification | Configured provider-account reference, headers and original request bytes | Durable accepted/duplicate acknowledgement or explicit rejection; acknowledgement alone is not delivery proof |
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
   enforce size/replay/deduplication controls, validate scope and correlate the
   known submission. An unverifiable callback cannot change business state.
   Use authenticated polling when callback trust cannot be established.
5. **Retrieve:** retain the exact XML and attachments actually received, with
   hashes and provenance. Reconstructed XML from provider JSON is not the
   transported original. Missing-original support is an explicit integration
   gap, not permission to claim archival compatibility.

Local keys alone do not guarantee exactly-once external delivery. After an
uncertain send, do not blindly retry unless documented provider idempotency or
reconciliation establishes safety. Otherwise retain `unknown`, surface an
operator action and require an explicit resolution. Poll failures preserve the
last known delivery evidence rather than declaring a delivered invoice failed.

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

### Synthetic mock examples

These describe the adapter boundary, not a provider API or proof of valid UBL.
Fixture identifiers are planned offline fixtures. ODEE-014 supplies actual
version-pinned valid/invalid XML; no example authorizes a network call.

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
  "providerSubmissionId": "mock-submission-001",
  "transport": "provider_accepted",
  "businessResponse": "none",
  "financialMutation": false
}
```

The mock resolves `payloadFixture` to immutable bytes, participants and a
computed hash; callers cannot substitute a fixture label for production XML.
An identical repeat returns the same submission reference. Different bytes
with the same key return an explicit conflict. The uncertain-send scenario
returns `SEND_OUTCOME_UNKNOWN` with `retrySafe: false` and preserves the attempt
for reconciliation. A signed synthetic callback may advance transport but
never changes the ledger.

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
