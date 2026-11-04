package accounting

import (
	"errors"
	"math"
	"reflect"
	"testing"
)

func policyInput(lines ...CalculationLineInput) CalculationInput {
	return CalculationInput{Currency: "EUR", CurrencyExponent: 2, Lines: lines}
}

func policyLine(id string, quantity, unitPrice, tax int64) CalculationLineInput {
	return CalculationLineInput{
		LineID:         id,
		QuantityUnits:  quantity,
		UnitPriceUnits: unitPrice,
		TaxRateBPS:     tax,
	}
}

func TestCalculatePolicyFractionalQuantityAndResidue(t *testing.T) {
	result, err := CalculatePolicy(policyInput(policyLine("fractional", 3334, 150, 0)))
	if err != nil {
		t.Fatal(err)
	}
	if result.NetMinor != 1 || result.TaxMinor != 0 || result.GrossMinor != 1 {
		t.Fatalf("unexpected totals: %+v", result)
	}
	if result.PolicyID != CalculationPolicyID || result.SchemaVersion != CalculationPolicySchema {
		t.Fatalf("policy lineage: %s/%d", result.PolicyID, result.SchemaVersion)
	}
	line := result.Lines[0]
	if line.NetMinor != 1 || line.NetRoundingResidue != (ExactRational{Numerator: "4999", Denominator: "10000"}) {
		t.Fatalf("unexpected line result: %+v", line)
	}
}

func TestCalculatePolicyDiscountOrderAndBoundaries(t *testing.T) {
	line := policyLine("discount", 10_000, 1_000_000, 0)
	line.FixedDiscountUnits = 100_000
	line.PercentageDiscountBPS = []int64{1000}
	result, err := CalculatePolicy(policyInput(line))
	if err != nil {
		t.Fatal(err)
	}
	if result.NetMinor != 8100 {
		t.Fatalf("fixed-then-percent result = %d, want 8100", result.NetMinor)
	}

	line = policyLine("full-discount", 10_000, 1_000_000, 0)
	line.PercentageDiscountBPS = []int64{10_000}
	line2 := policyLine("remaining", 10_000, 100, 0)
	result, err = CalculatePolicy(policyInput(line, line2))
	if err != nil {
		t.Fatal(err)
	}
	if result.Lines[0].NetMinor != 0 || result.GrossMinor != 1 {
		t.Fatalf("100%% stage did not zero only its line: %+v", result)
	}

	invalidFixed := policyLine("too-much", 10_000, 1_000_000, 0)
	invalidFixed.FixedDiscountUnits = 1_000_001
	assertInvalidCalculation(t, policyInput(invalidFixed))

	equalFixed := policyLine("equal-fixed", 10_000, 10_000, 0)
	equalFixed.FixedDiscountUnits = 10_000
	positive := policyLine("positive", 10_000, 100, 0)
	result, err = CalculatePolicy(policyInput(equalFixed, positive))
	if err != nil {
		t.Fatal(err)
	}
	if result.Lines[0].LineID != "equal-fixed" || result.Lines[0].NetMinor != 0 {
		t.Fatalf("fixed discount equal to exact extension should be accepted: %+v", result.Lines)
	}
}

func TestCalculatePolicyMixedRatesAndMainTicketOracle(t *testing.T) {
	mixed, err := CalculatePolicy(policyInput(
		policyLine("standard", 10_000, 1_000_000, 2100),
		policyLine("reduced", 10_000, 500_000, 600),
	))
	if err != nil {
		t.Fatal(err)
	}
	if mixed.NetMinor != 15000 || mixed.TaxMinor != 2400 || mixed.GrossMinor != 17400 {
		t.Fatalf("mixed-rate totals: %+v", mixed)
	}
	if !reflect.DeepEqual(mixed.TaxGroups, []CalculationTaxGroupResult{
		{TaxRateBPS: 600, NetMinor: 5000, TaxMinor: 300, IndependentLineTax: 300},
		{TaxRateBPS: 2100, NetMinor: 10000, TaxMinor: 2100, IndependentLineTax: 2100},
	}) {
		t.Fatalf("mixed-rate groups: %+v", mixed.TaxGroups)
	}

	main, err := CalculatePolicy(policyInput(
		policyLine("line-a", 10_000, 1_000_000, 2100),
		policyLine("line-b", 10_000, 1_000_000, 2100),
	))
	if err != nil {
		t.Fatal(err)
	}
	if main.NetMinor != 20000 || main.TaxMinor != 4200 || main.GrossMinor != 24200 {
		t.Fatalf("main ticket totals: %+v", main)
	}
}

func TestCalculatePolicyUsesSettledNetWeightsAndStableLineIDs(t *testing.T) {
	a := policyLine("line-a", 10_000, 149, 5000) // Exact extension: 1.49 cents.
	b := policyLine("line-b", 10_000, 51, 5000)  // Exact extension: 0.51 cents.
	first, err := CalculatePolicy(policyInput(a, b))
	if err != nil {
		t.Fatal(err)
	}
	second, err := CalculatePolicy(policyInput(b, a))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("input permutation changed deterministic result:\nfirst:  %+v\nsecond: %+v", first, second)
	}
	if first.NetMinor != 2 || first.TaxMinor != 1 || first.GrossMinor != 3 {
		t.Fatalf("grouped totals: %+v", first)
	}
	if len(first.TaxGroups) != 1 ||
		first.TaxGroups[0].IndependentLineTax != 2 ||
		first.TaxGroups[0].RoundingAdjustment != -1 {
		t.Fatalf("explicit group adjustment missing: %+v", first.TaxGroups)
	}
	if len(first.Lines) != 2 ||
		first.Lines[0].LineID != "line-a" || first.Lines[0].TaxMinor != 1 ||
		first.Lines[1].LineID != "line-b" || first.Lines[1].TaxMinor != 0 {
		t.Fatalf("equal settled-net remainders must tie by stable ID: %+v", first.Lines)
	}
}

func TestCalculatePolicyCanonicalScaledInteger(t *testing.T) {
	for input, want := range map[string]int64{
		"0": 0, "3334": 3334, "-3334": -3334,
		"9223372036854775807":  math.MaxInt64,
		"-9223372036854775808": math.MinInt64,
	} {
		got, err := ParseCanonicalScaledInteger(input)
		if err != nil || got != want {
			t.Errorf("ParseCanonicalScaledInteger(%q) = %d, %v; want %d", input, got, err, want)
		}
	}
	for _, input := range []string{"", "+1", "-0", "00", "01", "-01", " 1", "1 ", "1.0", "1e2", "9223372036854775808", "-9223372036854775809"} {
		if _, err := ParseCanonicalScaledInteger(input); !errors.Is(err, ErrInvalid) {
			t.Errorf("ParseCanonicalScaledInteger(%q) error = %v, want ErrInvalid", input, err)
		}
	}
}

func TestCalculatePolicyRejectsInvalidInputsWithoutMutation(t *testing.T) {
	valid := policyLine("valid", 10_000, 1_000_000, 2100)
	makeLine := func(change func(*CalculationLineInput)) CalculationInput {
		line := valid
		change(&line)
		return policyInput(line)
	}
	tests := []struct {
		name  string
		input CalculationInput
	}{
		{"missing id", makeLine(func(line *CalculationLineInput) { line.LineID = "" })},
		{"invalid utf8 id", makeLine(func(line *CalculationLineInput) { line.LineID = string([]byte{0xff}) })},
		{"zero quantity", makeLine(func(line *CalculationLineInput) { line.QuantityUnits = 0 })},
		{"negative quantity", makeLine(func(line *CalculationLineInput) { line.QuantityUnits = -1 })},
		{"quantity over bound", makeLine(func(line *CalculationLineInput) { line.QuantityUnits = calculationMaxQuantityUnits + 1 })},
		{"negative unit price", makeLine(func(line *CalculationLineInput) { line.UnitPriceUnits = -1 })},
		{"unit price over bound", makeLine(func(line *CalculationLineInput) { line.UnitPriceUnits = calculationMaxUnitPriceUnits + 1 })},
		{"negative fixed discount", makeLine(func(line *CalculationLineInput) { line.FixedDiscountUnits = -1 })},
		{"negative percentage discount", makeLine(func(line *CalculationLineInput) { line.PercentageDiscountBPS = []int64{-1} })},
		{"percentage discount over 100%", makeLine(func(line *CalculationLineInput) { line.PercentageDiscountBPS = []int64{10_001} })},
		{"too many percentage stages", makeLine(func(line *CalculationLineInput) { line.PercentageDiscountBPS = []int64{0, 0, 0, 0, 0} })},
		{"negative tax", makeLine(func(line *CalculationLineInput) { line.TaxRateBPS = -1 })},
		{"tax over 100%", makeLine(func(line *CalculationLineInput) { line.TaxRateBPS = 10_001 })},
		{"extension over bound", makeLine(func(line *CalculationLineInput) {
			line.QuantityUnits = calculationMaxQuantityUnits
			line.UnitPriceUnits = 1_000_000_001
		})},
		{"zero document total", policyInput(policyLine("zero", 10_000, 0, 0))},
		{"wrong currency", CalculationInput{Currency: "USD", CurrencyExponent: 2, Lines: []CalculationLineInput{valid}}},
		{"wrong exponent", CalculationInput{Currency: "EUR", CurrencyExponent: 0, Lines: []CalculationLineInput{valid}}},
		{"no lines", policyInput()},
		{"too many lines", policyInput(make([]CalculationLineInput, calculationMaxLines+1)...)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			before := cloneCalculationInput(test.input)
			assertInvalidCalculation(t, test.input)
			if !reflect.DeepEqual(test.input, before) {
				t.Fatal("calculator mutated its input")
			}
		})
	}
	duplicate := valid
	duplicate.LineID = valid.LineID
	assertInvalidCalculation(t, policyInput(valid, duplicate))
}

func TestCalculatePolicyDocumentAmountBound(t *testing.T) {
	lines := make([]CalculationLineInput, 10)
	for i := range lines {
		lines[i] = policyLine(string(rune('a'+i)), calculationMaxQuantityUnits, 1_000_000_000, 0)
	}
	result, err := CalculatePolicy(policyInput(lines...))
	if err != nil {
		t.Fatal(err)
	}
	if result.GrossMinor != MaxAmount {
		t.Fatalf("maximum document total = %d, want %d", result.GrossMinor, MaxAmount)
	}
	assertInvalidCalculation(t, policyInput(append(lines, policyLine("overflow", calculationMaxQuantityUnits, 1_000_000_000, 0))...))
}

func TestCalculatePolicyMaximumInputBoundaries(t *testing.T) {
	result, err := CalculatePolicy(policyInput(
		policyLine("maximum-quantity", calculationMaxQuantityUnits, 1, 0),
		policyLine("maximum-price", 1, calculationMaxUnitPriceUnits, 0),
	))
	if err != nil {
		t.Fatal(err)
	}
	if result.Lines[0].LineID != "maximum-price" ||
		result.Lines[0].NetMinor != 100_000 ||
		result.Lines[1].LineID != "maximum-quantity" ||
		result.Lines[1].NetMinor != 100 {
		t.Fatalf("inclusive quantity/price bounds produced unexpected lines: %+v", result.Lines)
	}

	lines := make([]CalculationLineInput, calculationMaxLines)
	for i := range lines {
		lines[i] = policyLine(string(rune(0x1000+i)), 10_000, 100, 0)
	}
	if _, err := CalculatePolicy(policyInput(lines...)); err != nil {
		t.Fatalf("inclusive 100-line boundary rejected: %v", err)
	}
}

func TestCalculatePolicyOrderAndTaxRoundingBoundaries(t *testing.T) {
	// A 100%-discounted line may be zero when another line keeps the document
	// positive. A single positive half-cent net rounds up exactly once.
	line := policyLine("half-cent", 10_000, 50, 0)
	other := policyLine("discounted", 10_000, 10_000, 0)
	other.PercentageDiscountBPS = []int64{10_000}
	result, err := CalculatePolicy(policyInput(line, other))
	if err != nil {
		t.Fatal(err)
	}
	if result.Lines[0].LineID != "discounted" ||
		result.Lines[0].NetMinor != 0 ||
		result.Lines[1].LineID != "half-cent" ||
		result.Lines[1].NetMinor != 1 ||
		result.NetMinor != 1 {
		t.Fatalf("half-up net result: %+v", result)
	}
}

func assertInvalidCalculation(t *testing.T, input CalculationInput) {
	t.Helper()
	if _, err := CalculatePolicy(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("CalculatePolicy error = %v, want ErrInvalid", err)
	}
}

func cloneCalculationInput(input CalculationInput) CalculationInput {
	clone := input
	clone.Lines = append([]CalculationLineInput(nil), input.Lines...)
	for i := range clone.Lines {
		clone.Lines[i].PercentageDiscountBPS = append([]int64(nil), input.Lines[i].PercentageDiscountBPS...)
	}
	return clone
}
