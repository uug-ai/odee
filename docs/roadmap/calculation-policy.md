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

Use scaled integers at API and persistence boundaries; accept decimal strings
or integer-scaled values, never binary floating-point values:

| Input | Proposed representation and bound |
| --- | --- |
| Quantity | Four decimal places; greater than zero and at most `1,000,000.0000`. |
| Unit price | Four decimal places in currency major units; from `0.0000` through `1,000,000.0000`. |
| Fixed line discount | At most one amount per line, four decimal places in currency major units; from zero through the exact pre-discount line extension. |
| Percentage discounts | At most four ordered stages per line; each an integer number of basis points from `0` through `10,000` (100%). |
| Tax rate | An integer number of basis points from `0` through `10,000`; the rate is an input, not a tax-category or legal-applicability decision. |
| Currency | Final ledger amounts are integer minor units using the document's captured currency exponent. Require an explicit supported exponent from `0` through `4`; reject missing or unsupported currency precision rather than guessing. |
| Document | At most 10,000 lines; each pre-discount extension at most `1,000,000,000` major units; each finalized net, tax, and gross document amount at most `10^13` minor units. |

These are proposed product bounds, not statements about statutory limits or
business suitability. Inputs with more than four fractional digits, negative
quantities/prices/discounts/rates, unsupported currency precision, or values
outside these bounds fail explicitly. Do not silently round, clamp, reinterpret,
or convert them. If a valid future use case exceeds a bound, review a policy
revision rather than expanding it implicitly.

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

Persist line-net rounding residue as a signed, reduced rational number in minor
units: `settledLineNet - exactDiscountedLineNet`, with canonical integer
numerator and positive denominator serialized as decimal strings. It is
calculation evidence, not an extra ledger amount.

For each tax-rate group, also persist an integer-minor-unit document tax
adjustment:

`roundedGroupTax - sum(roundHalfUp(each line's exact tax independently))`.

Allocate the rounded group tax to its lines by the largest-remainder method:
start from each exact line tax's floor in minor units, distribute the remaining
group minor units to the largest fractional remainders, and break ties by
stable line identifier. Persist each allocated line tax and the group
adjustment so the line display reconciles exactly to the document tax. Do not
hide a group difference in a line amount or silently change the group total.

Use exact integer/rational intermediates, with a 128-decimal-digit cap on
canonical intermediate numerators and denominators. A bound violation or
unrepresentable result is an explicit overflow/error with no successful
calculation or write.

### Policy lineage, drafts, posting, and legacy behavior

New drafts persist the policy ID and schema version independently of chart
configuration. Ordinary draft save and posting retain the draft's recognized
policy; chart activation cannot recalculate a draft or posted document. The
posted snapshot records the policy ID/version, captured currency precision,
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
| Explicit document rounding adjustment | Two separate lines each have rounded net `1` cent and tax input `5000` bp. Each exact line tax is `0.5` cent. | Per-line half-up tax would sum to `2` cents, but group tax is half-up on `2` cents = `1` cent. Persist group adjustment `-1` cent and allocate `1` cent to the first stable line ID and `0` to the other (equal-remainder tie). The allocated lines sum to the group tax. |
| Main ticket total | Two separate lines each quantity `1`, unit price EUR `100.0000`, tax input `2100` bp. | Net `20000`, VAT `4200`, total `24200` cents in API and UI. |
| Recognized legacy/payment compatibility | Legacy invoice has two separate lines, each quantity `1`, unit price `1` cent and tax input `5000` bp; policy metadata is absent. After installing this policy and activating another chart version, record a valid manual payment of `1` cent. | Preserve legacy per-line half-up results: net `2`, VAT `2`, total `4` cents; payment leaves `3` cents outstanding and uses the original bank/receivable meanings. Preserve original lines, totals, posted entries, and partner/company captures; no migration or recalculation. |

The implementation and independent QA must additionally prove that stale and
failed conversion attempts do not mutate a draft, unknown history remains
unresolved without mutation, and policy/snapshot/state/version/audit updates
are atomic within the scoped document write.

## Decisions requiring PM and independent review

1. Approve or replace the proposed scales, numeric bounds, supported currency
   exponents, line-count/amount limits, and intermediate digit cap against
   product needs and the storage/API types.
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
5. Obtain independent ledger, API/data, integration, and localization review
   of the fixtures and historical verification/payment path. Qualified finance
   or legal review is needed for any statutory tax mapping or applicability
   claim; none is made here.

This is only the bounded design candidate for ODEE-009 revision 2. It is not
full ODEE-009 acceptance, does not update roadmap/backlog execution state, and
authorizes neither product implementation nor parallel ODEE-010 work.
