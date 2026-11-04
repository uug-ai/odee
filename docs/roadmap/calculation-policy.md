# ODEE-009 revision 2: calculation-policy design candidate

**Status:** pre-implementation design proposal for PM and independent finance
review. This document proposes arithmetic choices; it does not establish a
statutory tax rule, approve finance acceptance, or authorize product
implementation. The ticket remains the acceptance contract.

## Proposed choices for review

### Policy identity and fixed-scale inputs

Use an immutable policy identity such as `exact-fixed-v1` with schema version
`1`. Its registry definition must pin all scales, bounds, discount ordering,
tax treatment, rounding, and adjustment serialization. A chart-configuration
identity is separate and cannot select or replace a calculation policy.

Use one canonical representation at the new-policy boundary: JSON decimal
strings containing base-10 scaled integers, with no exponent, sign for
nonnegative values, whitespace, or leading zeroes except the value `"0"`.
Persist the same scaled values as BSON signed 64-bit integers; serialize them
back to the canonical JSON string form. Never accept JSON floating-point
numbers for these fields, and never calculate ledger money with binary
floating-point arithmetic. The policy schema defines each integer's scale:

| Field | Canonical integer string | Meaning |
| --- | --- | --- |
| Quantity | `quantityUnits` | Quantity multiplied by `10,000`; `"3334"` means `0.3334`. |
| Unit price | `unitPriceUnits` | Currency major units multiplied by `10,000`; `"150"` means `0.0150` currency units. |
| Fixed line discount | `discountUnits` | Currency major units multiplied by `10,000`, at the same scale as unit price. |
| Percentage discount and tax rate | `basisPoints` | Integer basis points; `"2100"` means 21%. |
| Settled net, tax, gross, and payment amounts | `minorUnits` | Integer currency minor units at the document's captured currency exponent. |

These are API and persisted value encodings for the proposed policy schema,
not a description of the current numeric API. The user-facing form accepts
localized decimal notation and converts it exactly to the canonical scaled
integer string before sending a request. English accepts `.` as the decimal
mark; Dutch accepts `,`. Editable numeric fields must match `0` or a nonzero
digit followed by digits, optionally followed by the locale decimal mark and
one to four fractional digits. Grouping separators, exponent notation, signs
for nonnegative values, any whitespace, leading zeroes, a decimal mark from
the other locale, and more than four fractional digits are rejected; input is
never rounded or guessed. Trailing fractional zeroes up to four places are
permitted. Rendering uses the active locale with exactly four fractional
digits for quantity and unit-price/discount values, and exactly the captured
currency exponent for currency totals; formatting never changes the stored/API
value.

| Locale input | Canonical value | Result |
| --- | --- | --- |
| English quantity `0.3334` | `quantityUnits: "3334"` | Accepted. |
| Dutch quantity `0,3334` | `quantityUnits: "3334"` | Accepted. |
| English unit price `0.0150` / Dutch `0,0150` | `unitPriceUnits: "150"` | Accepted; renders back as `0.0150` / `0,0150`. |
| English `0,3334` or Dutch `0.3334` | — | Rejected: wrong decimal mark. |
| English `1,000.0000` or Dutch `1.000,0000` | — | Rejected: grouping separators are not accepted in input. |
| English `0.33345` or Dutch `0,33345` | — | Rejected: precision exceeds four places; no rounding. |
| Quantity units `"3334"` | English `0.3334`; Dutch `0,3334` | Render exactly four fractional digits. |
| EUR minor units `"1000"` | English `€10.00`; Dutch `€ 10,00` | Render exactly two currency fractional digits. |
| `00.5`, `.5`, `+0.5`, `-0.5`, or `0.00000` | — | Rejected: invalid whole part, sign, or precision. |

The proposed display oracle for the EUR examples is `€100.0000` /
`€ 100,0000` for a unit price in English / Dutch, and `€100.00` /
`€ 100,00` for finalized currency amounts. Locale controls presentation only,
not policy selection or arithmetic.

| Input | Proposed representation and bound |
| --- | --- |
| Quantity | `quantityUnits`: greater than zero and at most `100,000,000` (10,000.0000), retaining the current quantity ceiling. |
| Unit price | `unitPriceUnits`: from zero through `100,000,000,000` (10,000,000.0000) currency major units, equivalent to the current EUR 1,000,000,000-cent ceiling. |
| Fixed line discount | At most one `discountUnits` amount per line, from zero through the exact pre-discount line extension. |
| Percentage discounts | At most four ordered stages per line; each `basisPoints` value is from zero through `10,000` (100%). |
| Tax rate | `basisPoints` from zero through `10,000`; the rate is an input, not a tax-category or legal-applicability decision. |
| Currency | This proposed policy version supports EUR only, with captured exponent `2`. Reject any other currency or exponent explicitly; do not infer precision from locale or a mutable currency table. |
| Document | At most 100 lines, retaining the current line-count ceiling; each pre-discount extension, document subtotal, tax, total, each posting entry, paid amount, and each payment amount must remain at or below `1,000,000,000,000` minor units (`MaxAmount`). |

These are proposed product bounds, not statements about statutory limits or
business suitability. Inputs outside the representation or bounds fail
explicitly. Do not silently round, clamp, reinterpret, or convert them. If a
valid future use case exceeds a bound, review a policy revision rather than
expanding it implicitly.

The proposed policy is intentionally EUR-only. Capture `"EUR"` and exponent
`2` when a new-policy draft is created; save and posting retain those captured
values. A draft with a missing, mismatched, or unsupported currency/exponent
is explicitly unresolved and is not repaired from current settings. This
proposal adds no foreign-currency ledger support, exchange rates, conversion,
or FX gain/loss accounting. The present accounting model defaults new
documents to EUR and the finance configuration's legacy recognition is EUR-only
(`internal/accounting/model.go`, `NewDocument`; `internal/accounting/configuration_finance.go`,
`legacyShape`). Imported foreign-currency scans do not authorize a foreign
currency ledger.

### Discount order and taxable base

For each line, calculate the exact quantity-times-unit-price extension. Subtract
the optional fixed line discount first, then apply percentage discounts in their
stored order, each to the exact remaining amount. Do not round between stages.
Reject a fixed discount greater than the exact extension; do not cap it. A
100% percentage stage yields zero. Document-level discounts are not supported
by this proposed version and must be rejected rather than allocated by an
undocumented rule.

Round the resulting nonnegative line net once to the currency minor unit using
round-half-up. Sum those settled line nets by their captured tax-rate input.
For each rate group, calculate tax from that group's summed rounded net and
round once to a minor unit using round-half-up. Tax is therefore calculated
after line discounts and line-net rounding. The rate is supplied by the
document's explicit tax selection; this policy does not infer a rate, exemption,
reverse-charge treatment, or legal applicability.

There is no second rounding of the document grand total: it is the sum of
settled line nets and rounded tax groups. Cash rounding and other whole-document
rounding are outside this proposed version.

### Explicit rounding adjustments

Every new-policy line has a unique, opaque, immutable `lineId` generated by the
server when that line is first accepted into a draft. Persist it with the line
and return it in draft responses. On later saves, existing IDs identify retained
lines regardless of edits or array order; an omitted ID on a newly added line
causes the server to mint a new one. The server rejects duplicate IDs and
nonexistent submitted IDs, treats omitted prior IDs as explicit line removal,
and returns newly assigned IDs so subsequent saves can preserve them. Reordering
does not change IDs. The same IDs survive policy preview/conversion and posting.
IDs are unique within their document; no calculation or tie break uses array
position.

Recognized legacy lines have no new-policy `lineId`; do not backfill, migrate,
or relabel them during read, verification, ordinary save/post, or payment.
Legacy arithmetic remains its original per-line policy and does not use a
line-ID allocation tie break. A legacy draft may receive IDs only inside an
explicitly requested conversion preview. That preview returns the exact
proposed IDs, calculations, and a server-issued preview token bound to the
draft version and target policy; acceptance must present that token and the
same expected version. IDs and converted values are persisted only if the
reviewed conversion is accepted. Missing
IDs on a record already marked as the new policy, duplicate IDs, or unresolved
legacy identity needed by a conversion is an explicit no-mutation unresolved
or validation outcome, never an array-position fallback.

Persist line-net rounding residue as a signed, reduced rational number in minor
units: `settledLineNet - exactDiscountedLineNet`, with canonical integer
numerator and positive denominator serialized as decimal strings. It is
calculation evidence, not an extra ledger amount.

For each tax-rate group, calculate each line's exact tax from that line's
already-rounded (settled) line net multiplied by the group's rate, before
rounding that line tax. Do not use the pre-round discounted extension as the
allocation weight. Also persist an integer-minor-unit document tax adjustment:

`roundedGroupTax - sum(roundHalfUp(each settledLineNet × rate))`.

Allocate the rounded group tax to its lines by the largest-remainder method:
start from each settled-net tax's floor in minor units, distribute the
remaining group minor units to the largest fractional remainders, and break
ties by lexicographically ascending UTF-8 bytes of the stable, unique `lineId`.
Persist each allocated line tax and the group adjustment so the line display
reconciles exactly to the document tax. Do not hide a group difference in a
line amount or silently change the group total.

Use exact integer/rational intermediates, with a 128-decimal-digit cap on
canonical intermediate numerators and denominators. A bound violation or
unrepresentable result is an explicit overflow/error with no successful
calculation or write. The `10^12` minor-unit ceiling deliberately retains the
current accounting `MaxAmount` bound: line accumulation and document totals
must not exceed it, posting debits/credits must stay within it, and payment
amounts cannot exceed the outstanding amount (which is itself bounded by the
document total). Do not enlarge those bounds to match intermediate precision.
The current store also marshals the entire proposed document before a write
and rejects BSON larger than 16 MiB; retain that pre-write check for create and
save, even for documents below the 100-line logical limit. Passing the line
count does not guarantee a write can fit in BSON.

### Policy lineage, drafts, posting, and legacy behavior

New drafts persist the policy ID and schema version independently of chart
configuration. Ordinary draft save and posting retain the draft's recognized
policy and captured EUR currency/exponent; chart activation cannot recalculate
a draft or posted document. The posted snapshot records the policy ID/version,
captured EUR currency/exponent,
calculation inputs, rounded line and tax-group results, and explicit
adjustments, so historical interpretation does not depend on a mutable current
policy registry entry.

A document without new metadata is a recognized legacy policy, not unknown:
integer quantities, integer-cent prices, and per-line half-up rounding remain
the original meaning without migration. Keep legacy verification, display,
posting where otherwise valid, and manual payment on that policy even after
installing the new policy or activating a different chart version. Preserve
the original lines, totals, posted entries, partner/company captures, and
original bank/receivable meanings.

Any supported policy conversion is an explicit draft-only operation carrying
an expected document version and target policy ID/version. It must return the
exact reviewed before/after line values, tax, total, and adjustments; require
the caller to accept that outcome against the same expected version; and never
refresh partner/company captures or rebind the chart. Stale versions, failed
calculations, and rejected previews leave the draft unchanged. Policy metadata,
posted financial snapshot/state/version, and the existing financial audit must
be committed in the same scoped document write. No automatic migration or
conversion is required for recognized legacy drafts.

A genuinely unsupported or unknown policy/history returns an explicit
unresolved outcome without mutation. Do not relabel recognized legacy records
as unknown because their representation predates this schema.

## Proposed independent arithmetic fixtures

All amounts below use EUR examples with two minor-unit digits. Tax rates and
discounts are fixture inputs only; these examples do not assert statutory
applicability.

| Case | Inputs | Expected result |
| --- | --- | --- |
| Fractional quantity and line residue | Quantity `0.3334`; unit price `0.0150`; no discount; tax `0` bp. Exact line extension is EUR `0.005001` = `0.5001` cents. | Half-up line net is `1` cent. Persist line residue `+4999/10000` cent (`1 - 0.5001`). |
| Discount order and boundaries | Quantity `1`; unit price EUR `100.0000`; fixed line discount EUR `10.0000`; then `1000` bp (`10%`). | Discounted net is EUR `81.00` = `8100` cents; applying the percentage before the fixed amount would produce EUR `80.00`, so order is observable. A zero discount leaves EUR `100.00`; a 100% stage yields zero; fixed discount above EUR `100.0000`, or a rate above `10,000` bp, is rejected without clamping. |
| Mixed rates | Line A: quantity `1`, unit price EUR `100.0000`, tax input `2100` bp. Line B: quantity `1`, unit price EUR `50.0000`, tax input `600` bp. | Net `15000` cents; tax groups `2100` and `300` cents; total `17400` cents. |
| Explicit document rounding adjustment | Two lines have exact discounted extensions `1.49` and `0.51` cents, which each settle to `1` cent; both use `5000` bp and IDs `line-a` and `line-b`. | Group tax is half-up on settled net `2 × 50%` = `1` cent. Allocate from settled-net tax weights `0.5`/`0.5` cent, so ID tie-break gives `1` cent to `line-a`, `0` to `line-b`; the independent per-line half-up sum is `2`, so group adjustment is `-1`. Using pre-round extension weights (`0.745`/`0.255`) would incorrectly allocate by a different basis. |
| Main ticket total | Two separate lines each quantity `1`, unit price EUR `100.0000`, tax input `2100` bp. | Net `20000`, VAT `4200`, total `24200` cents in API and UI. |
| Recognized legacy/payment compatibility | Legacy invoice has two separate lines, each quantity `1`, unit price `1` cent and tax input `5000` bp; policy metadata is absent. After installing this policy and activating another chart version, record a valid manual payment of `1` cent. | Preserve legacy per-line half-up results: net `2`, VAT `2`, total `4` cents; payment leaves `3` cents outstanding and uses the original bank/receivable meanings. Preserve original lines, totals, posted entries, and partner/company captures; no migration or recalculation. |

The implementation and independent QA must additionally prove that stale and
failed conversion attempts do not mutate a draft, unknown history remains
unresolved without mutation, and policy/snapshot/state/version/audit updates
are atomic within the scoped document write.

## Decisions requiring PM and independent review

1. Approve or replace the proposed scales, numeric bounds, supported currency
   policy (EUR-only, exponent 2), line-count/amount limits, and intermediate
   digit cap against product needs and the storage/API types. Review the
   currency capture point and explicit rejection behavior before any future
   multicurrency scope is considered.
2. Confirm that one fixed line discount followed by up to four percentage
   stages is the intended supported model, and that document-level discounts
   remain explicitly unsupported in this version.
3. Confirm line-net half-up rounding, tax per rounded taxable-rate group,
   largest-remainder line allocation, tie-breaking, and the signed adjustment
   fields. Review whether the rational line residue should be persisted or
   retained in a more bounded exact audit representation.
4. Confirm failure shapes and transactional/version-checked conversion UX,
   including whether conversion is needed at all; it remains optional and
   cannot be a prerequisite for recognized legacy use.
5. Confirm the opaque line-ID lifecycle and no-migration legacy rule, including
   server-generated IDs, duplicate/unknown ID errors, reorder stability, and
   ID-based rounding tie-breaks.
6. Confirm the locale-independent wire/BSON encoding and English/Dutch input,
   rejection, and rendering oracles; locale must not select arithmetic policy.
7. Obtain independent ledger, API/data, integration, and localization review
   of the fixtures and historical verification/payment path. Qualified finance
   or legal review is needed for any statutory tax mapping or applicability
   claim; none is made here.

## Current-baseline grounding for the open review findings

These references describe why the preceding behaviors are proposals rather
than existing guarantees: current `Line` has no stable ID and uses integer
quantity/unit cents, and `SetDraft` currently permits 1 to 100 lines
(`internal/accounting/model.go`, `Line` and `SetDraft`); new documents
default to EUR (`NewDocument`); current frontend money input is a two-decimal
string parser and formats cents for English/Dutch (`web/src/accounting.ts`,
`cents` and `money`); current accounting finance recognition accepts EUR only
(`internal/accounting/configuration_finance.go`, `legacyShape`). The existing
`MaxAmount` is `1,000,000,000,000` minor units and is enforced during line
accumulation, posting-entry validation, and payment-versus-outstanding checks
(`internal/accounting/model.go`, `MaxAmount`, `SetDraft`, `Balanced`, and
`RecordPayment`). The store's `documentSize` marshals and rejects BSON over
16 MiB before create/save writes (`internal/accounting/store.go`). This document
does not change those implementation facts or assert that the proposed
revision-2 contract is implemented.

This is only the bounded design candidate for ODEE-009 revision 2. It is not
full ODEE-009 acceptance, does not update roadmap/backlog execution state, and
authorizes neither product implementation nor parallel ODEE-010 work.
