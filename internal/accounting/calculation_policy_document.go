package accounting

import (
	"encoding/json"
	"net/mail"
	"reflect"
	"strconv"
	"strings"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ScaledInteger uses BSON int64 storage and a canonical decimal-string JSON
// representation so API clients never round through JSON floating point.
type ScaledInteger int64

func (value ScaledInteger) MarshalJSON() ([]byte, error) {
	return json.Marshal(strconv.FormatInt(int64(value), 10))
}

func (value *ScaledInteger) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return invalid("scaled values must be canonical JSON decimal strings")
	}
	parsed, err := ParseCanonicalScaledInteger(raw)
	if err != nil {
		return err
	}
	*value = ScaledInteger(parsed)
	return nil
}

type documentJSON Document

func (d Document) MarshalJSON() ([]byte, error) {
	raw, err := json.Marshal(documentJSON(d))
	if err != nil || (d.CalculationPolicy == nil && d.Calculation == nil) {
		return raw, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	payments := make([]struct {
		ID        string  `json:"id"`
		Date      string  `json:"date"`
		Amount    string  `json:"amount"`
		Reference string  `json:"reference"`
		Entries   []Entry `json:"entries"`
	}, len(d.Payments))
	for i, payment := range d.Payments {
		payments[i] = struct {
			ID        string  `json:"id"`
			Date      string  `json:"date"`
			Amount    string  `json:"amount"`
			Reference string  `json:"reference"`
			Entries   []Entry `json:"entries"`
		}{
			ID: payment.ID, Date: payment.Date, Amount: strconv.FormatInt(payment.Amount, 10),
			Reference: payment.Reference, Entries: payment.Entries,
		}
	}
	fields["payments"], err = json.Marshal(payments)
	if err != nil {
		return nil, err
	}
	return json.Marshal(fields)
}

func (d *Document) UnmarshalJSON(data []byte) error {
	type documentAlias Document
	var envelope struct {
		CalculationPolicy *CalculationPolicyMetadata `json:"calculationPolicy"`
		Calculation       *CalculationResult         `json:"calculation"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return err
	}
	if envelope.CalculationPolicy != nil || envelope.Calculation != nil {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return err
		}
		var rawPayments []json.RawMessage
		if err := json.Unmarshal(fields["payments"], &rawPayments); err != nil {
			return err
		}
		payments := make([]json.RawMessage, len(rawPayments))
		for i, rawPayment := range rawPayments {
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(rawPayment, &fields); err != nil {
				return err
			}
			var amount ScaledInteger
			if err := json.Unmarshal(fields["amount"], &amount); err != nil {
				return err
			}
			var err error
			fields["amount"], err = json.Marshal(int64(amount))
			if err != nil {
				return err
			}
			payments[i], err = json.Marshal(fields)
			if err != nil {
				return err
			}
		}
		var err error
		fields["payments"], err = json.Marshal(payments)
		if err != nil {
			return err
		}
		data, err = json.Marshal(fields)
		if err != nil {
			return err
		}
	}
	var decoded documentAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*d = Document(decoded)
	return nil
}

// CalculationPolicyMetadata is an explicit opt-in carried by new-policy
// drafts and persisted independently of chart configuration.
type CalculationPolicyMetadata struct {
	PolicyID         string `json:"policyId" bson:"policyId"`
	SchemaVersion    int    `json:"schemaVersion" bson:"schemaVersion"`
	Currency         string `json:"currency" bson:"currency"`
	CurrencyExponent int    `json:"currencyExponent" bson:"currencyExponent"`
}

// PolicyLineData is the exact input needed to recalculate one policy line.
// Scaled values are BSON int64 and canonical JSON decimal strings.
type PolicyLineData struct {
	LineID                string          `json:"lineId,omitempty" bson:"lineId,omitempty"`
	QuantityUnits         ScaledInteger   `json:"quantityUnits" bson:"quantityUnits"`
	UnitPriceUnits        ScaledInteger   `json:"unitPriceUnits" bson:"unitPriceUnits"`
	FixedDiscountUnits    ScaledInteger   `json:"fixedDiscountUnits" bson:"fixedDiscountUnits"`
	PercentageDiscountBPS []ScaledInteger `json:"percentageDiscountBps" bson:"percentageDiscountBps"`
	TaxRateBPS            ScaledInteger   `json:"taxRateBps" bson:"taxRateBps"`
}

func (line PolicyLineData) input() CalculationLineInput {
	discounts := make([]int64, len(line.PercentageDiscountBPS))
	for i, value := range line.PercentageDiscountBPS {
		discounts[i] = int64(value)
	}
	return CalculationLineInput{
		LineID: line.LineID, QuantityUnits: int64(line.QuantityUnits),
		UnitPriceUnits: int64(line.UnitPriceUnits), FixedDiscountUnits: int64(line.FixedDiscountUnits),
		PercentageDiscountBPS: discounts, TaxRateBPS: int64(line.TaxRateBPS),
	}
}

func (d *Document) setCalculationPolicyDraft(input Draft) error {
	if d.Status != "draft" {
		return invalid("posted documents are immutable")
	}
	if input.CalculationPolicy == nil ||
		input.CalculationPolicy.PolicyID != CalculationPolicyID ||
		input.CalculationPolicy.SchemaVersion != CalculationPolicySchema ||
		input.CalculationPolicy.Currency != "EUR" ||
		input.CalculationPolicy.CurrencyExponent != calculationCurrencyExponent {
		return invalid("calculation policy identity or currency is unsupported")
	}
	if d.Kind != "" && d.Kind != input.Kind {
		return invalid("document kind cannot change")
	}
	if d.CalculationPolicy == nil && len(d.Lines) != 0 {
		return invalid("legacy policy conversion is unsupported; the document was not changed")
	}
	if d.CalculationPolicy != nil && !sameCalculationPolicy(*d.CalculationPolicy, *input.CalculationPolicy) {
		return invalid("calculation policy cannot be replaced implicitly")
	}
	if d.CalculationPolicy != nil && d.Calculation == nil {
		return invalid("calculation policy history is unresolved")
	}
	if d.CalculationPolicy == nil && d.Calculation != nil {
		return invalid("calculation policy history is unresolved")
	}
	if input.Kind != "invoice" && input.Kind != "bill" {
		return invalid("kind must be invoice or bill")
	}
	input.Partner = strings.TrimSpace(input.Partner)
	input.Email = strings.TrimSpace(input.Email)
	if input.Partner == "" || utf8.RuneCountInString(input.Partner) > 200 ||
		len(input.Email) > 254 || utf8.RuneCountInString(input.Reference) > 300 {
		return invalid("provide a partner name; partner, email or reference is too long")
	}
	if input.Email != "" {
		address, err := mail.ParseAddress(input.Email)
		if err != nil || address.Address != input.Email {
			return invalid("provide a valid email address or leave it empty")
		}
	}
	if !ValidDate(input.Date) || !ValidDate(input.DueDate) || input.DueDate < input.Date {
		return invalid("provide valid dates with due date on or after document date")
	}
	if len(input.Lines) == 0 || len(input.Lines) > calculationMaxLines {
		return invalid("a calculation-policy document needs 1 to 100 lines")
	}

	existingIDs := map[string]struct{}{}
	if d.CalculationPolicy != nil {
		for _, line := range d.Lines {
			if line.Calculation == nil || !validCalculationLineID(line.Calculation.LineID) {
				return invalid("calculation policy history is unresolved")
			}
			existingIDs[line.Calculation.LineID] = struct{}{}
		}
	}
	seen := make(map[string]struct{}, len(input.Lines))
	nextLines := make([]Line, len(input.Lines))
	engineLines := make([]CalculationLineInput, len(input.Lines))
	for i, line := range input.Lines {
		line.Description = strings.TrimSpace(line.Description)
		if line.Description == "" || utf8.RuneCountInString(line.Description) > 500 {
			return invalid("each line needs a description of at most 500 characters")
		}
		if line.Quantity != 0 || line.UnitCents != 0 || line.TaxBPS != 0 {
			return invalid("new-policy lines must use canonical calculation fields, not legacy numeric fields")
		}
		if len(line.AccountCode) < 1 || len(line.AccountCode) > 12 || strings.Trim(line.AccountCode, "0123456789") != "" {
			return invalid("invalid line account code")
		}
		if d.ConfigurationSelection == nil || d.ConfigurationSelection.Policy == starterPolicy {
			expected := "4000"
			if input.Kind == "bill" {
				expected = "5000"
			}
			if line.AccountCode != expected {
				return invalid("invoice lines use Sales revenue; bill lines use Operating expenses")
			}
		}
		if line.Calculation == nil {
			return invalid("each new-policy line needs calculation inputs")
		}
		calculation := *line.Calculation
		if calculation.LineID != "" {
			if _, exists := existingIDs[calculation.LineID]; !exists {
				return invalid("line ID is unknown for this draft")
			}
		} else {
			calculation.LineID = primitive.NewObjectID().Hex()
		}
		if _, exists := seen[calculation.LineID]; exists {
			return invalid("line IDs must be unique within the document")
		}
		seen[calculation.LineID] = struct{}{}
		line.Calculation = &calculation
		nextLines[i], engineLines[i] = line, calculation.input()
	}

	result, err := CalculatePolicy(CalculationInput{
		Currency: input.CalculationPolicy.Currency, CurrencyExponent: input.CalculationPolicy.CurrencyExponent,
		Lines: engineLines,
	})
	if err != nil {
		return err
	}
	nextMetadata := *input.CalculationPolicy
	d.Kind, d.Partner, d.Email, d.Reference = input.Kind, input.Partner, input.Email, strings.TrimSpace(input.Reference)
	d.Date, d.DueDate, d.Currency = input.Date, input.DueDate, result.Currency
	d.Lines = nextLines
	d.Subtotal, d.Tax, d.Total = int64(result.NetMinor), int64(result.TaxMinor), int64(result.GrossMinor)
	d.CalculationPolicy, d.Calculation = &nextMetadata, &result
	return nil
}

func sameCalculationPolicy(a, b CalculationPolicyMetadata) bool {
	return a == b
}

func recognizedCalculationPolicy(doc Document) bool {
	if doc.CalculationPolicy == nil || doc.Calculation == nil ||
		doc.CalculationPolicy.PolicyID != CalculationPolicyID ||
		doc.CalculationPolicy.SchemaVersion != CalculationPolicySchema ||
		doc.CalculationPolicy.Currency != "EUR" ||
		doc.CalculationPolicy.CurrencyExponent != calculationCurrencyExponent {
		return false
	}
	copy := clone(doc)
	copy.Status = "draft"
	input := copy.draftValue()
	if err := copy.setCalculationPolicyDraft(input); err != nil {
		return false
	}
	return copy.Currency == doc.Currency &&
		copy.Subtotal == doc.Subtotal && copy.Tax == doc.Tax && copy.Total == doc.Total &&
		reflect.DeepEqual(copy.CalculationPolicy, doc.CalculationPolicy) &&
		reflect.DeepEqual(copy.Calculation, doc.Calculation) &&
		reflect.DeepEqual(copy.Lines, doc.Lines)
}
