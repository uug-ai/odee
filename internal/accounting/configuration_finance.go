package accounting

import (
	"context"
	"errors"
	"reflect"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
)

func selectedConfiguration(ctx context.Context, store Store, doc Document) (ConfigurationData, error) {
	if doc.ConfigurationSelection == nil || doc.ConfigurationSelection.Policy == starterPolicy {
		if !legacyShape(doc) && !recognizedCalculationPolicy(doc) {
			return ConfigurationData{}, invalid("financial meaning is unknown; reconcile before changing this document")
		}
		return starterConfiguration(), nil
	}
	selection := doc.ConfigurationSelection
	if selection.VersionID == nil || selection.Policy != "" {
		return ConfigurationData{}, invalid("financial meaning is unknown; reconcile before changing this document")
	}
	p, err := store.Configuration(doc.OrganisationID).Published(ctx, *selection.VersionID)
	if err != nil {
		return ConfigurationData{}, err
	}
	if p.Payload.Digest != selection.Digest {
		return ConfigurationData{}, invalid("published configuration integrity check failed")
	}
	return p.Payload.Data, nil
}
func bindNewConfiguration(ctx context.Context, store Store, doc *Document) error {
	head, err := store.Configuration(doc.OrganisationID).Head(ctx)
	if errors.Is(err, ErrNotFound) {
		selection := starterSelection()
		doc.ConfigurationSelection = &selection
		doc.JournalCode = starterConfiguration().Mappings[doc.Kind+"Journal"]
		return nil
	}
	if err != nil {
		return err
	}
	if head.Default.VersionID == nil {
		if head.Default.Revision != 0 {
			return invalid("default configuration reference is missing")
		}
		selection := starterSelection()
		doc.ConfigurationSelection = &selection
		doc.JournalCode = starterConfiguration().Mappings[doc.Kind+"Journal"]
		return nil
	}
	p, err := store.Configuration(doc.OrganisationID).Published(ctx, *head.Default.VersionID)
	if err != nil {
		return err
	}
	doc.ConfigurationSelection = &ConfigurationSelection{VersionID: &p.ID, Digest: p.Payload.Digest}
	doc.JournalCode = p.Payload.Data.Mappings[doc.Kind+"Journal"]
	return nil
}
func configuredEntries(kind string, total, subtotal, tax int64, data ConfigurationData) []Entry {
	var entries []Entry
	if kind == "invoice" {
		entries = []Entry{{data.Mappings["receivable"], total, 0}, {data.Mappings["revenue"], 0, subtotal}}
		if tax > 0 {
			entries = append(entries, Entry{data.Mappings["vatPayable"], 0, tax})
		}
	} else {
		entries = []Entry{{data.Mappings["expense"], subtotal, 0}, {data.Mappings["payable"], 0, total}}
		if tax > 0 {
			entries = append(entries, Entry{data.Mappings["vatRecoverable"], tax, 0})
		}
	}
	return entries
}
func legacyShape(d Document) bool {
	if d.CalculationPolicy != nil || d.Calculation != nil {
		return false
	}
	if d.ConfigurationSelection != nil {
		selection := starterSelection()
		if !reflect.DeepEqual(*d.ConfigurationSelection, selection) {
			return false
		}
	}
	if d.Currency != "EUR" || (d.Kind != "invoice" && d.Kind != "bill") {
		return false
	}
	expected := "4000"
	if d.Kind == "bill" {
		expected = "5000"
	}
	for _, line := range d.Lines {
		if line.AccountCode != expected {
			return false
		}
	}
	copy := d
	copy.Status = "draft"
	if err := copy.SetDraft(Draft{
		Kind: d.Kind, Partner: d.Partner, Email: d.Email, Reference: d.Reference,
		Date: d.Date, DueDate: d.DueDate, Lines: d.Lines,
	}); err != nil || copy.Total != d.Total || copy.Subtotal != d.Subtotal || copy.Tax != d.Tax {
		return false
	}
	if d.Status == "draft" {
		return len(d.Entries) == 0 && len(d.Payments) == 0 && d.Paid == 0
	}
	if d.Status != "posted" && d.Status != "paid" {
		return false
	}
	data := starterConfiguration()
	if !reflect.DeepEqual(d.Entries, configuredEntries(d.Kind, d.Total, d.Subtotal, d.Tax, data)) {
		return false
	}
	paid := int64(0)
	keys := map[string]bool{}
	for _, p := range d.Payments {
		if !ValidDate(p.Date) || p.Date < d.Date || p.Amount <= 0 || p.ID == "" || len(p.ID) > 100 || keys[p.ID] || len(d.Payments) > 200 {
			return false
		}
		keys[p.ID] = true
		paid += p.Amount
		if !reflect.DeepEqual(p.Entries, paymentEntries(d.Kind, p.Amount, data)) {
			return false
		}
	}
	return paid == d.Paid && paid <= d.Total && ((d.Status == "paid" && paid == d.Total) || (d.Status == "posted" && paid < d.Total))
}
func paymentEntries(kind string, amount int64, data ConfigurationData) []Entry {
	if kind == "invoice" {
		return []Entry{{data.Mappings["bank"], amount, 0}, {data.Mappings["receivable"], 0, amount}}
	}
	return []Entry{{data.Mappings["payable"], amount, 0}, {data.Mappings["bank"], 0, amount}}
}
func (d Document) snapshot(data ConfigurationData) (*FinancialSnapshot, error) {
	selection := starterSelection()
	if d.ConfigurationSelection != nil {
		selection = copyConfiguration(*d.ConfigurationSelection)
	}
	roles := []string{"bank", "receivable", "revenue", "vatPayable"}
	if d.Kind == "bill" {
		roles = []string{"bank", "payable", "expense", "vatRecoverable"}
	}
	frozen := &FinancialSnapshot{SchemaVersion: 1, Selection: selection, Accounts: []ConfigAccount{}, Mappings: map[string]string{}, Journals: []ConfigJournal{}}
	seen := map[string]bool{}
	for _, role := range roles {
		code := data.Mappings[role]
		a, ok := data.account(code)
		if !ok {
			return nil, invalid("missing financial meaning")
		}
		frozen.Mappings[role] = code
		if !seen[code] {
			frozen.Accounts = append(frozen.Accounts, a)
			seen[code] = true
		}
	}
	for _, op := range []string{d.Kind, "payment"} {
		code := data.Mappings[op+"Journal"]
		j, ok := data.journal(code)
		if !ok {
			return nil, invalid("missing financial journal")
		}
		frozen.Mappings[op+"Journal"] = code
		frozen.Journals = append(frozen.Journals, j)
	}
	for _, year := range data.Years {
		for _, p := range year.Periods {
			if p.Active && p.Start <= d.Date && d.Date <= p.End {
				frozen.Period = p
			}
		}
	}
	if frozen.Period.Start == "" {
		return nil, invalid("document date is outside supported fiscal periods")
	}
	raw, err := bson.Marshal(frozen)
	if err != nil || len(raw) > 16*1024 {
		return nil, invalid("financial projection size limit exceeded")
	}
	return frozen, nil
}
func (d Document) frozenConfiguration() (ConfigurationData, error) {
	if d.FinancialSnapshot == nil {
		if !legacyShape(d) && !recognizedCalculationPolicy(d) {
			return ConfigurationData{}, invalid("financial meaning is unknown; reconcile before changing this document")
		}
		return starterConfiguration(), nil
	}
	f := d.FinancialSnapshot
	data := ConfigurationData{Accounts: f.Accounts, Mappings: f.Mappings, Journals: f.Journals, Years: []FiscalYear{{f.Period.Start, f.Period.End, []FiscalPeriod{f.Period}}}}
	if f.SchemaVersion != 1 || d.ConfigurationSelection == nil || !reflect.DeepEqual(f.Selection, *d.ConfigurationSelection) || len(f.Accounts) > 7 || len(f.Journals) > 2 || len(data.readiness(d.Kind)) > 0 || !ValidDate(f.Period.Start) || !ValidDate(f.Period.End) {
		return data, invalid("frozen financial meaning integrity check failed")
	}
	if f.Selection.Policy != "" {
		if f.Selection.Policy != starterPolicy || (!legacyShape(d) && !recognizedCalculationPolicy(d)) {
			return data, invalid("frozen financial meaning integrity check failed")
		}
	} else if f.Selection.VersionID == nil || f.Selection.VersionID.IsZero() || len(f.Selection.Digest) != 64 {
		return data, invalid("frozen financial meaning integrity check failed")
	}
	if !reflect.DeepEqual(d.Entries, configuredEntries(d.Kind, d.Total, d.Subtotal, d.Tax, data)) {
		return data, invalid("frozen financial meaning integrity check failed")
	}
	for _, p := range d.Payments {
		if !reflect.DeepEqual(p.Entries, paymentEntries(d.Kind, p.Amount, data)) {
			return data, invalid("frozen financial meaning integrity check failed")
		}
	}
	return data, nil
}
func (d *Document) displayFinancialMeaning() {
	if d.Status == "draft" {
		return
	}
	data, err := d.frozenConfiguration()
	if err != nil {
		d.MeaningError = "Financial meaning unknown"
		return
	}
	if d.FinancialSnapshot != nil {
		d.FinancialMeaning = copyConfiguration(d.FinancialSnapshot)
		return
	}
	d.FinancialMeaning, err = d.snapshot(data)
	if err != nil {
		d.MeaningError = "Financial meaning unknown"
	}
}
func (d Document) postingReadiness(data ConfigurationData) error {
	if issues := data.readiness(d.Kind); len(issues) > 0 {
		return invalid("configuration is not ready: " + strings.Join(issues, "; "))
	}
	j, ok := data.journal(d.JournalCode)
	if !ok || !j.Active || j.Kind != d.Kind || d.JournalCode != data.Mappings[d.Kind+"Journal"] {
		return invalid("selected journal is unsupported")
	}
	role := "revenue"
	if d.Kind == "bill" {
		role = "expense"
	}
	for _, line := range d.Lines {
		if line.AccountCode != data.Mappings[role] {
			return invalid("line account does not match selected configuration")
		}
	}
	return nil
}
