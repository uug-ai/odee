package accounting

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func exactPolicyDraft(kind string) Draft {
	account := "4000"
	if kind == "bill" {
		account = "5000"
	}
	return Draft{
		Kind: kind, Partner: "Exact policy example", Date: "2026-11-03", DueDate: "2026-12-03",
		CalculationPolicy: &CalculationPolicyMetadata{
			PolicyID: CalculationPolicyID, SchemaVersion: CalculationPolicySchema,
			Currency: "EUR", CurrencyExponent: 2,
		},
		Lines: []Line{
			{Description: "Fractional unit", AccountCode: account, Calculation: &PolicyLineData{
				QuantityUnits: 3334, UnitPriceUnits: 150, PercentageDiscountBPS: []ScaledInteger{},
			}},
			{Description: "Main amount", AccountCode: account, Calculation: &PolicyLineData{
				QuantityUnits: 10_000, UnitPriceUnits: 10_000_000, TaxRateBPS: 2100,
				PercentageDiscountBPS: []ScaledInteger{},
			}},
		},
	}
}

func TestCalculationPolicyDocumentLifecycleAndStableLineIDs(t *testing.T) {
	input := exactPolicyDraft("invoice")
	doc, err := NewDocument(input, testCompany)
	if err != nil {
		t.Fatal(err)
	}
	if doc.CalculationPolicy == nil || doc.Calculation == nil ||
		doc.CalculationPolicy.PolicyID != CalculationPolicyID ||
		doc.Calculation.PolicyID != CalculationPolicyID ||
		doc.Currency != "EUR" || doc.Total != 121_001 {
		t.Fatalf("new policy document: %+v", doc)
	}
	firstIDs := []string{doc.Lines[0].Calculation.LineID, doc.Lines[1].Calculation.LineID}
	if firstIDs[0] == "" || firstIDs[1] == "" || firstIDs[0] == firstIDs[1] {
		t.Fatalf("line IDs were not server-generated uniquely: %v", firstIDs)
	}
	if doc.Lines[0].Quantity != 0 || doc.Lines[0].UnitCents != 0 || doc.Lines[0].TaxBPS != 0 {
		t.Fatal("new-policy line was silently reinterpreted as legacy values")
	}
	if !recognizedCalculationPolicy(doc) {
		t.Fatal("new draft was not recognized by its policy lineage")
	}

	reordered := doc.draftValue()
	reordered.Lines[0], reordered.Lines[1] = reordered.Lines[1], reordered.Lines[0]
	if err := doc.SetDraft(reordered); err != nil {
		t.Fatal(err)
	}
	if doc.Lines[0].Calculation.LineID != firstIDs[1] ||
		doc.Lines[1].Calculation.LineID != firstIDs[0] ||
		!recognizedCalculationPolicy(doc) {
		t.Fatalf("line identity did not survive reordering: %+v", doc.Lines)
	}

	before := clone(doc)
	duplicate := clone(doc).draftValue()
	duplicate.Lines[1].Calculation.LineID = duplicate.Lines[0].Calculation.LineID
	if err := doc.SetDraft(duplicate); !errors.Is(err, ErrInvalid) {
		t.Fatalf("duplicate line ID error = %v", err)
	}
	if !reflect.DeepEqual(before, clone(doc)) {
		t.Fatal("duplicate ID rejection mutated document")
	}
	unknown := clone(doc).draftValue()
	unknown.Lines[0].Calculation.LineID = "unknown-line"
	if err := doc.SetDraft(unknown); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown line ID error = %v", err)
	}
	if !reflect.DeepEqual(before, clone(doc)) {
		t.Fatal("unknown ID rejection mutated document")
	}
	implicitConversion := clone(doc).draftValue()
	implicitConversion.CalculationPolicy.PolicyID = "unreviewed-policy"
	if err := doc.SetDraft(implicitConversion); !errors.Is(err, ErrInvalid) {
		t.Fatalf("policy replacement error = %v", err)
	}
	if !reflect.DeepEqual(before, clone(doc)) {
		t.Fatal("policy replacement rejection mutated document")
	}
}

func TestCalculationPolicyDocumentLegacyConversionIsExplicitlyUnsupported(t *testing.T) {
	legacy, err := NewDocument(draft("invoice"), testCompany)
	if err != nil {
		t.Fatal(err)
	}
	before := clone(legacy)
	converted := exactPolicyDraft("invoice")
	if err := legacy.SetDraft(converted); !errors.Is(err, ErrInvalid) {
		t.Fatalf("legacy conversion error = %v", err)
	}
	if !reflect.DeepEqual(before, clone(legacy)) {
		t.Fatal("unsupported legacy conversion mutated document")
	}
}

func TestCalculationPolicyDocumentBSONAndJSONRoundTrip(t *testing.T) {
	doc, err := NewDocument(exactPolicyDraft("invoice"), testCompany)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := bson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	var restored Document
	if err := bson.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(doc.CalculationPolicy, restored.CalculationPolicy) ||
		!reflect.DeepEqual(doc.Calculation, restored.Calculation) ||
		doc.Currency != restored.Currency || doc.Subtotal != restored.Subtotal ||
		doc.Tax != restored.Tax || doc.Total != restored.Total ||
		!reflect.DeepEqual(doc.Lines, restored.Lines) {
		t.Fatalf("BSON round trip changed calculation data:\nwant: %+v\ngot: %+v", doc, restored)
	}
	var stored bson.M
	if err := bson.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	lines := stored["lines"].(bson.A)
	firstLine := lines[0].(bson.M)
	calculation := firstLine["calculation"].(bson.M)
	if _, ok := calculation["quantityUnits"].(int64); !ok {
		t.Fatalf("BSON scaled input type = %T, want int64", calculation["quantityUnits"])
	}
	storedResult := stored["calculation"].(bson.M)
	if _, ok := storedResult["netMinor"].(int64); !ok {
		t.Fatalf("BSON result amount type = %T, want int64", storedResult["netMinor"])
	}
	jsonBytes, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(jsonBytes, &wire); err != nil {
		t.Fatal(err)
	}
	wireLines := wire["lines"].([]any)
	exactLine := wireLines[0].(map[string]any)
	wireCalculation := exactLine["calculation"].(map[string]any)
	if wireCalculation["quantityUnits"] != "3334" || wireCalculation["unitPriceUnits"] != "150" {
		t.Fatalf("scaled API fields were not canonical strings: %s", jsonBytes)
	}
	if wire["currency"] != "EUR" {
		t.Fatalf("document currency not captured: %s", jsonBytes)
	}
	result := wire["calculation"].(map[string]any)
	if result["netMinor"] != "100001" || result["taxMinor"] != "21000" || result["grossMinor"] != "121001" {
		t.Fatalf("settled API amounts were not canonical strings: %s", jsonBytes)
	}
	groups := result["taxGroups"].([]any)
	if groups[1].(map[string]any)["taxRateBps"] != "2100" {
		t.Fatalf("tax rate result was not a canonical string: %s", jsonBytes)
	}
}
