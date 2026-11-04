package accounting

import (
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	CalculationPolicyID                    = "exact-fixed-v1"
	CalculationPolicySchema                = 1
	calculationScale                 int64 = 10_000
	calculationMinorUnitFactor       int64 = 100
	calculationQuantityPriceDivisor  int64 = calculationScale * calculationScale / calculationMinorUnitFactor
	calculationCurrencyExponent            = 2
	calculationMaxLines                    = 100
	calculationMaxIntermediateDigits       = 128
	calculationMaxExtensionMinor     int64 = 100_000_000_000
	calculationMaxQuantityUnits      int64 = 100_000_000
	calculationMaxUnitPriceUnits     int64 = 100_000_000_000
	calculationMaxDiscountStages           = 4
)

// CalculationLineInput contains exact scaled-integer inputs for one new-policy
// line. LineID is supplied by the owning document layer and must be stable.
type CalculationLineInput struct {
	LineID                string
	QuantityUnits         int64
	UnitPriceUnits        int64
	FixedDiscountUnits    int64
	PercentageDiscountBPS []int64
	TaxRateBPS            int64
}

// CalculationInput is the pure engine boundary for one EUR document.
type CalculationInput struct {
	Currency         string
	CurrencyExponent int
	Lines            []CalculationLineInput
}

// ExactRational stores a reduced exact value as canonical base-10 integers.
type ExactRational struct {
	Numerator   string
	Denominator string
}

// CalculationLineResult is calculated from one input line. TaxMinor is the
// line's largest-remainder allocation from its tax-rate group.
type CalculationLineResult struct {
	LineID             string
	NetMinor           int64
	TaxMinor           int64
	GrossMinor         int64
	NetRoundingResidue ExactRational
}

// CalculationTaxGroupResult records the grouped tax and its explicit
// difference from independent half-up rounding of each settled line net.
type CalculationTaxGroupResult struct {
	TaxRateBPS         int64
	NetMinor           int64
	TaxMinor           int64
	IndependentLineTax int64
	RoundingAdjustment int64
}

// CalculationResult contains settled minor-unit values in stable line-ID and
// tax-rate order. It has no side effects and does not apply to legacy records.
type CalculationResult struct {
	PolicyID         string
	SchemaVersion    int
	Currency         string
	CurrencyExponent int
	NetMinor         int64
	TaxMinor         int64
	GrossMinor       int64
	Lines            []CalculationLineResult
	TaxGroups        []CalculationTaxGroupResult
}

// ParseCanonicalScaledInteger accepts only canonical signed base-10 int64
// strings, suitable for the new policy's locale-independent JSON wire values.
func ParseCanonicalScaledInteger(value string) (int64, error) {
	if value == "" {
		return 0, invalid("scaled integer is empty")
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || strconv.FormatInt(parsed, 10) != value {
		return 0, invalid("scaled integer is not canonical or exceeds int64")
	}
	return parsed, nil
}

// CalculatePolicy computes the exact fixed-scale policy without mutating its
// inputs or consulting current configuration. Persisted document integration
// must select this function only for its explicitly identified policy.
func CalculatePolicy(input CalculationInput) (CalculationResult, error) {
	if input.Currency != "EUR" || input.CurrencyExponent != calculationCurrencyExponent {
		return CalculationResult{}, invalid("calculation policy supports EUR with exponent 2 only")
	}
	if len(input.Lines) == 0 || len(input.Lines) > calculationMaxLines {
		return CalculationResult{}, invalid("calculation document needs 1 to 100 lines")
	}

	seen := make(map[string]struct{}, len(input.Lines))
	lines := make([]CalculationLineResult, 0, len(input.Lines))
	groupLines := make(map[int64][]*calculationGroupLine)
	result := CalculationResult{
		PolicyID:         CalculationPolicyID,
		SchemaVersion:    CalculationPolicySchema,
		Currency:         input.Currency,
		CurrencyExponent: input.CurrencyExponent,
		Lines:            make([]CalculationLineResult, 0, len(input.Lines)),
	}

	for _, line := range input.Lines {
		if !validCalculationLineID(line.LineID) {
			return CalculationResult{}, invalid("line ID must be nonempty valid UTF-8")
		}
		if _, exists := seen[line.LineID]; exists {
			return CalculationResult{}, invalid("line IDs must be unique within the document")
		}
		seen[line.LineID] = struct{}{}
		if line.QuantityUnits <= 0 || line.QuantityUnits > calculationMaxQuantityUnits ||
			line.UnitPriceUnits < 0 || line.UnitPriceUnits > calculationMaxUnitPriceUnits ||
			line.FixedDiscountUnits < 0 || line.TaxRateBPS < 0 || line.TaxRateBPS > calculationScale ||
			len(line.PercentageDiscountBPS) > calculationMaxDiscountStages {
			return CalculationResult{}, invalid("quantity, price, discount, or tax rate is outside policy bounds")
		}
		for _, rate := range line.PercentageDiscountBPS {
			if rate < 0 || rate > calculationScale {
				return CalculationResult{}, invalid("percentage discount is outside policy bounds")
			}
		}

		// Quantity and unit price each carry four decimal places; converting
		// their product to EUR minor units divides by 10^6.
		exactExtension := new(big.Rat).SetFrac(
			new(big.Int).Mul(big.NewInt(line.QuantityUnits), big.NewInt(line.UnitPriceUnits)),
			big.NewInt(calculationQuantityPriceDivisor),
		)
		if !withinIntermediateLimit(exactExtension) ||
			exactExtension.Cmp(new(big.Rat).SetInt64(calculationMaxExtensionMinor)) > 0 {
			return CalculationResult{}, invalid("pre-discount line extension exceeds the supported bound")
		}

		// Fixed discounts use the same 10^-4 major-unit scale as prices.
		fixedDiscount := new(big.Rat).SetFrac(
			big.NewInt(line.FixedDiscountUnits),
			big.NewInt(calculationScale/calculationMinorUnitFactor),
		)
		if !withinIntermediateLimit(fixedDiscount) || fixedDiscount.Cmp(exactExtension) > 0 {
			return CalculationResult{}, invalid("fixed line discount exceeds the exact line extension")
		}
		exactNet := new(big.Rat).Sub(exactExtension, fixedDiscount)
		if !withinIntermediateLimit(exactNet) {
			return CalculationResult{}, invalid("calculation intermediate exceeds the supported precision")
		}
		for _, rate := range line.PercentageDiscountBPS {
			factor := new(big.Rat).SetFrac(big.NewInt(calculationScale-rate), big.NewInt(calculationScale))
			exactNet.Mul(exactNet, factor)
			if !withinIntermediateLimit(exactNet) {
				return CalculationResult{}, invalid("calculation intermediate exceeds the supported precision")
			}
		}
		netMinor, err := roundHalfUpNonnegative(exactNet)
		if err != nil || netMinor > MaxAmount {
			return CalculationResult{}, invalid("settled line net exceeds the supported amount")
		}
		residue := new(big.Rat).Sub(new(big.Rat).SetInt64(netMinor), exactNet)
		if !withinIntermediateLimit(residue) {
			return CalculationResult{}, invalid("line rounding residue exceeds the supported precision")
		}

		lineResult := CalculationLineResult{
			LineID:             line.LineID,
			NetMinor:           netMinor,
			NetRoundingResidue: exactRational(residue),
		}
		result.NetMinor, err = checkedAdd(result.NetMinor, netMinor)
		if err != nil || result.NetMinor > MaxAmount {
			return CalculationResult{}, invalid("document net exceeds the supported amount")
		}
		lines = append(lines, lineResult)
		groupLines[line.TaxRateBPS] = append(groupLines[line.TaxRateBPS], &calculationGroupLine{
			id:       line.LineID,
			netMinor: netMinor,
		})
	}

	rates := make([]int64, 0, len(groupLines))
	for rate := range groupLines {
		rates = append(rates, rate)
	}
	sort.Slice(rates, func(i, j int) bool { return rates[i] < rates[j] })

	lineByID := make(map[string]*CalculationLineResult, len(lines))
	for i := range lines {
		lineByID[lines[i].LineID] = &lines[i]
	}
	for _, rate := range rates {
		group := groupLines[rate]
		tax, independentTax, err := calculateTaxGroup(rate, group)
		if err != nil {
			return CalculationResult{}, err
		}
		adjustment, err := checkedSub(tax, independentTax)
		if err != nil {
			return CalculationResult{}, invalid("tax rounding adjustment overflows")
		}
		groupNet := int64(0)
		for _, item := range group {
			groupNet, err = checkedAdd(groupNet, item.netMinor)
			if err != nil {
				return CalculationResult{}, invalid("tax group net overflows")
			}
			lineByID[item.id].TaxMinor = item.allocatedTax
		}
		result.TaxMinor, err = checkedAdd(result.TaxMinor, tax)
		if err != nil || result.TaxMinor > MaxAmount {
			return CalculationResult{}, invalid("document tax exceeds the supported amount")
		}
		result.TaxGroups = append(result.TaxGroups, CalculationTaxGroupResult{
			TaxRateBPS:         rate,
			NetMinor:           groupNet,
			TaxMinor:           tax,
			IndependentLineTax: independentTax,
			RoundingAdjustment: adjustment,
		})
	}

	sort.Slice(lines, func(i, j int) bool { return lines[i].LineID < lines[j].LineID })
	result.Lines = lines
	for i := range result.Lines {
		var err error
		result.Lines[i].GrossMinor, err = checkedAdd(result.Lines[i].NetMinor, result.Lines[i].TaxMinor)
		if err != nil {
			return CalculationResult{}, invalid("line gross overflows")
		}
	}
	var err error
	result.GrossMinor, err = checkedAdd(result.NetMinor, result.TaxMinor)
	if err != nil || result.GrossMinor > MaxAmount || result.GrossMinor == 0 {
		return CalculationResult{}, invalid("document gross is zero or exceeds the supported amount")
	}
	return result, nil
}

type calculationGroupLine struct {
	id           string
	netMinor     int64
	allocatedTax int64
	remainder    int64
}

func calculateTaxGroup(rate int64, lines []*calculationGroupLine) (int64, int64, error) {
	exactGroupTax := new(big.Rat)
	var independentLineTax int64
	for _, line := range lines {
		numerator := new(big.Int).Mul(big.NewInt(line.netMinor), big.NewInt(rate))
		exactLineTax := new(big.Rat).SetFrac(numerator, big.NewInt(calculationScale))
		if !withinIntermediateLimit(exactLineTax) {
			return 0, 0, invalid("tax intermediate exceeds the supported precision")
		}
		exactGroupTax.Add(exactGroupTax, exactLineTax)
		if !withinIntermediateLimit(exactGroupTax) {
			return 0, 0, invalid("tax group intermediate exceeds the supported precision")
		}
		rounded, err := roundHalfUpNonnegative(exactLineTax)
		if err != nil {
			return 0, 0, err
		}
		independentLineTax, err = checkedAdd(independentLineTax, rounded)
		if err != nil {
			return 0, 0, invalid("independent line tax sum overflows")
		}
		quotient, remainder := new(big.Int), new(big.Int)
		quotient.QuoRem(numerator, big.NewInt(calculationScale), remainder)
		line.allocatedTax = quotient.Int64()
		line.remainder = remainder.Int64()
	}

	groupTax, err := roundHalfUpNonnegative(exactGroupTax)
	if err != nil || groupTax > MaxAmount {
		return 0, 0, invalid("tax group exceeds the supported amount")
	}
	allocatedFloor := int64(0)
	for _, line := range lines {
		allocatedFloor, err = checkedAdd(allocatedFloor, line.allocatedTax)
		if err != nil {
			return 0, 0, invalid("allocated tax floor sum overflows")
		}
	}
	remaining := groupTax - allocatedFloor
	if remaining < 0 || remaining > int64(len(lines)) {
		return 0, 0, invalid("tax allocation remainder is outside the supported range")
	}
	sort.Slice(lines, func(i, j int) bool {
		if lines[i].remainder != lines[j].remainder {
			return lines[i].remainder > lines[j].remainder
		}
		return lines[i].id < lines[j].id
	})
	for i := int64(0); i < remaining; i++ {
		lines[i].allocatedTax++
	}
	return groupTax, independentLineTax, nil
}

func validCalculationLineID(id string) bool {
	return id != "" && utf8.ValidString(id)
}

func roundHalfUpNonnegative(value *big.Rat) (int64, error) {
	if value.Sign() < 0 || !withinIntermediateLimit(value) {
		return 0, invalid("rounding requires a bounded nonnegative exact value")
	}
	numerator := new(big.Int).Set(value.Num())
	denominator := value.Denom()
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(numerator, denominator, remainder)
	if new(big.Int).Lsh(remainder, 1).Cmp(denominator) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	if !quotient.IsInt64() {
		return 0, invalid("rounded amount exceeds int64")
	}
	return quotient.Int64(), nil
}

func exactRational(value *big.Rat) ExactRational {
	return ExactRational{
		Numerator:   value.Num().String(),
		Denominator: value.Denom().String(),
	}
}

func withinIntermediateLimit(value *big.Rat) bool {
	return decimalDigits(value.Num()) <= calculationMaxIntermediateDigits &&
		decimalDigits(value.Denom()) <= calculationMaxIntermediateDigits
}

func decimalDigits(value *big.Int) int {
	digits := len(strings.TrimPrefix(value.String(), "-"))
	if digits == 0 {
		return 1
	}
	return digits
}

func checkedAdd(a, b int64) (int64, error) {
	result := a + b
	if (b > 0 && result < a) || (b < 0 && result > a) {
		return 0, fmt.Errorf("integer addition overflow")
	}
	return result, nil
}

func checkedSub(a, b int64) (int64, error) {
	if b == -1<<63 {
		return 0, fmt.Errorf("integer subtraction overflow")
	}
	return checkedAdd(a, -b)
}
