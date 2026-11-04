package accounting

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
)

func TestCalculationPolicyAPICreateEditPostPayment(t *testing.T) {
	store := NewMemoryStore()
	server := &Server{Store: store, Company: testCompany, Dev: true, Origin: "http://127.0.0.1:19008"}
	handler := server.Handler()
	body, err := json.Marshal(exactPolicyDraft("invoice"))
	if err != nil {
		t.Fatal(err)
	}
	created := apiRequest(handler, http.MethodPost, "/api/documents", string(body), "", server.Origin)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status %d: %s", created.Code, created.Body)
	}
	var doc Document
	if err := json.Unmarshal(created.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CalculationPolicy == nil || doc.Calculation == nil ||
		doc.CalculationPolicy.PolicyID != CalculationPolicyID ||
		doc.Calculation.SchemaVersion != CalculationPolicySchema ||
		doc.Currency != "EUR" || doc.Total != 121_001 {
		t.Fatalf("created policy document: %+v", doc)
	}
	if doc.Lines[0].Calculation.LineID == "" || doc.Lines[1].Calculation.LineID == "" {
		t.Fatal("server did not mint line IDs")
	}
	path := "/api/documents/" + doc.ID.Hex()

	original, err := store.Get(t.Context(), doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	editedDraft := doc.draftValue()
	editedDraft.Lines[0], editedDraft.Lines[1] = editedDraft.Lines[1], editedDraft.Lines[0]
	editBody, err := json.Marshal(struct {
		Version int64 `json:"version"`
		Draft
	}{Version: doc.Version, Draft: editedDraft})
	if err != nil {
		t.Fatal(err)
	}
	edited := apiRequest(handler, http.MethodPut, path, string(editBody), "", server.Origin)
	if edited.Code != http.StatusOK {
		t.Fatalf("edit status %d: %s", edited.Code, edited.Body)
	}
	if err := json.Unmarshal(edited.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Version != 2 || doc.Lines[0].Calculation.LineID != original.Lines[1].Calculation.LineID {
		t.Fatalf("edit lost stable line identity: %+v", doc)
	}

	beforeRejected, err := store.Get(t.Context(), doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	duplicate := clone(doc).draftValue()
	duplicate.Lines[0].Calculation.LineID = duplicate.Lines[1].Calculation.LineID
	duplicateBody, _ := json.Marshal(struct {
		Version int64 `json:"version"`
		Draft
	}{Version: doc.Version, Draft: duplicate})
	rejected := apiRequest(handler, http.MethodPut, path, string(duplicateBody), "", server.Origin)
	if rejected.Code != http.StatusUnprocessableEntity {
		t.Fatalf("duplicate ID edit status %d: %s", rejected.Code, rejected.Body)
	}
	afterRejected, err := store.Get(t.Context(), doc.ID)
	if err != nil || !reflect.DeepEqual(beforeRejected, afterRejected) {
		t.Fatalf("rejected edit mutated stored document: %v", err)
	}

	post := apiRequest(handler, http.MethodPost, path+"/post", `{"version":2}`, "", server.Origin)
	if post.Code != http.StatusOK {
		t.Fatalf("post status %d: %s", post.Code, post.Body)
	}
	if err := json.Unmarshal(post.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Status != "posted" || doc.Version != 3 || doc.Calculation == nil ||
		int64(doc.Calculation.GrossMinor) != doc.Total {
		t.Fatalf("posted policy lineage not committed: %+v", doc)
	}
	stored, err := store.Get(t.Context(), doc.ID)
	if err != nil || len(stored.FinancialEvents) != 1 || !recognizedCalculationPolicy(stored) {
		t.Fatalf("posted policy/audit write not persisted together: %v %+v", err, stored)
	}
	beforePayment, err := store.Get(t.Context(), doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	invalidPayment := apiRequest(handler, http.MethodPost, path+"/payments",
		`{"version":3,"id":"numeric-one-cent","date":"2026-11-03","amount":1}`, "", server.Origin)
	if invalidPayment.Code != http.StatusUnprocessableEntity {
		t.Fatalf("numeric policy payment amount status %d: %s", invalidPayment.Code, invalidPayment.Body)
	}
	afterInvalidPayment, err := store.Get(t.Context(), doc.ID)
	if err != nil || !reflect.DeepEqual(beforePayment, afterInvalidPayment) {
		t.Fatalf("rejected payment encoding mutated document: %v", err)
	}
	payment := apiRequest(handler, http.MethodPost, path+"/payments",
		`{"version":3,"id":"one-cent","date":"2026-11-03","amount":"1"}`, "", server.Origin)
	if payment.Code != http.StatusOK {
		t.Fatalf("payment status %d: %s", payment.Code, payment.Body)
	}
	if err := json.Unmarshal(payment.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	var paymentWire map[string]any
	if err := json.Unmarshal(payment.Body.Bytes(), &paymentWire); err != nil {
		t.Fatal(err)
	}
	wirePayments := paymentWire["payments"].([]any)
	wirePayment := wirePayments[0].(map[string]any)
	if wirePayment["amount"] != "1" {
		t.Fatalf("new-policy payment amount was not a canonical string: %s", payment.Body)
	}
	if doc.Paid != 1 || doc.Total-doc.Paid != 121_000 ||
		doc.CalculationPolicy.PolicyID != CalculationPolicyID {
		t.Fatalf("policy metadata or payment outcome changed: %+v", doc)
	}
	stored, err = store.Get(t.Context(), doc.ID)
	if err != nil || len(stored.FinancialEvents) != 2 || !recognizedCalculationPolicy(stored) {
		t.Fatalf("payment/policy/audit write not persisted together: %v %+v", err, stored)
	}
}

func TestCalculationPolicyAPIRejectsNoncanonicalStringsAndLegacyConversion(t *testing.T) {
	server := &Server{Store: NewMemoryStore(), Company: testCompany, Dev: true, Origin: "http://127.0.0.1:19009"}
	handler := server.Handler()
	for _, value := range []string{
		`{"kind":"invoice","partner":"x","date":"2026-11-03","dueDate":"2026-12-03","calculationPolicy":{"policyId":"exact-fixed-v1","schemaVersion":1,"currency":"EUR","currencyExponent":2},"lines":[{"description":"x","accountCode":"4000","calculation":{"quantityUnits":3334,"unitPriceUnits":"150","fixedDiscountUnits":"0","percentageDiscountBps":[],"taxRateBps":"0"}}]}`,
		`{"kind":"invoice","partner":"x","date":"2026-11-03","dueDate":"2026-12-03","calculationPolicy":{"policyId":"unknown","schemaVersion":1,"currency":"EUR","currencyExponent":2},"lines":[]}`,
	} {
		response := apiRequest(handler, http.MethodPost, "/api/documents", value, "", server.Origin)
		if response.Code != http.StatusBadRequest && response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("invalid policy payload status %d: %s", response.Code, response.Body)
		}
	}

	legacy, err := NewDocument(draft("invoice"), testCompany)
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Store.Create(t.Context(), legacy); err != nil {
		t.Fatal(err)
	}
	conversion := exactPolicyDraft("invoice")
	raw, _ := json.Marshal(struct {
		Version int64 `json:"version"`
		Draft
	}{Version: legacy.Version, Draft: conversion})
	response := apiRequest(handler, http.MethodPut, "/api/documents/"+legacy.ID.Hex(), string(raw), "", server.Origin)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("implicit legacy conversion status %d: %s", response.Code, response.Body)
	}
	beforeConversion, err := server.Store.Get(t.Context(), legacy.ID)
	if err != nil {
		t.Fatal(err)
	}
	unchanged, err := server.Store.Get(t.Context(), legacy.ID)
	if err != nil || !reflect.DeepEqual(beforeConversion, unchanged) {
		t.Fatalf("failed conversion changed legacy history: %v", err)
	}
}

func TestCalculationPolicyAPIRejectsPaymentForUnknownHistory(t *testing.T) {
	store := NewMemoryStore()
	server := &Server{Store: store, Company: testCompany, Dev: true, Origin: "http://127.0.0.1:19010"}
	doc, err := NewDocument(exactPolicyDraft("invoice"), testCompany)
	if err != nil {
		t.Fatal(err)
	}
	if err := doc.Post(); err != nil {
		t.Fatal(err)
	}
	doc.CalculationPolicy.PolicyID = "unknown-policy"
	if err := store.Create(t.Context(), doc); err != nil {
		t.Fatal(err)
	}
	before, err := store.Get(t.Context(), doc.ID)
	if err != nil {
		t.Fatal(err)
	}

	response := apiRequest(server.Handler(), http.MethodPost,
		"/api/documents/"+doc.ID.Hex()+"/payments",
		`{"version":1,"id":"blocked","date":"2026-11-03","amount":1}`, "", server.Origin)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown policy payment status %d: %s", response.Code, response.Body)
	}
	after, err := store.Get(t.Context(), doc.ID)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("unknown policy payment mutated history: %v", err)
	}
}

func TestLegacyCalculationAndPaymentRemainUnchanged(t *testing.T) {
	input := draft("invoice")
	input.Lines = []Line{
		{Description: "One cent A", Quantity: 1, UnitCents: 1, TaxBPS: 5000, AccountCode: "4000"},
		{Description: "One cent B", Quantity: 1, UnitCents: 1, TaxBPS: 5000, AccountCode: "4000"},
	}
	doc, err := NewDocument(input, testCompany)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Subtotal != 2 || doc.Tax != 2 || doc.Total != 4 ||
		doc.CalculationPolicy != nil || doc.Calculation != nil {
		t.Fatalf("legacy arithmetic was changed: %+v", doc)
	}
	if err := doc.Post(); err != nil {
		t.Fatal(err)
	}
	if err := doc.RecordPayment(Payment{ID: "legacy-one-cent", Date: doc.Date, Amount: 1}); err != nil {
		t.Fatal(err)
	}
	if doc.Total-doc.Paid != 3 ||
		!reflect.DeepEqual(doc.Payments[0].Entries, []Entry{{"1000", 1, 0}, {"1100", 0, 1}}) {
		t.Fatalf("legacy payment changed historical meanings: %+v", doc)
	}
	legacyJSON, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	var legacyWire map[string]any
	if err := json.Unmarshal(legacyJSON, &legacyWire); err != nil {
		t.Fatal(err)
	}
	legacyPayments := legacyWire["payments"].([]any)
	if legacyPayments[0].(map[string]any)["amount"] != float64(1) {
		t.Fatalf("legacy payment amount encoding changed: %s", legacyJSON)
	}
	configuration, err := selectedConfiguration(t.Context(), NewMemoryStore(), doc)
	if err != nil || !reflect.DeepEqual(configuration, starterConfiguration()) {
		t.Fatalf("legacy calculation policy should remain the recognized starter policy: %v", err)
	}
	if _, err := doc.frozenConfiguration(); err != nil {
		t.Fatalf("legacy historical verification failed after payment: %v", err)
	}
}

func TestLegacyFractionalTaxInvoiceKeepsOriginalChartAcrossActivationAndPayment(t *testing.T) {
	ctx := t.Context()
	store := NewMemoryStore()
	configuration := store.Configuration(testCompany)
	v1 := stageAndPublish(t, store, starterConfiguration(), 0)
	if err := configuration.Activate(ctx, v1, 0); err != nil {
		t.Fatal(err)
	}

	input := draft("invoice")
	input.Lines = []Line{
		{Description: "One cent A", Quantity: 1, UnitCents: 1, TaxBPS: 5000, AccountCode: "4000"},
		{Description: "One cent B", Quantity: 1, UnitCents: 1, TaxBPS: 5000, AccountCode: "4000"},
	}
	doc, err := NewDocument(input, testCompany, ConfigurationSelection{
		VersionID: &v1.ID, Digest: v1.Payload.Digest,
	})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Subtotal != 2 || doc.Tax != 2 || doc.Total != 4 ||
		doc.CalculationPolicy != nil || doc.Calculation != nil {
		t.Fatalf("legacy fixture arithmetic changed: %+v", doc)
	}
	if err := store.Create(ctx, doc); err != nil {
		t.Fatal(err)
	}

	v2 := stageAndPublish(t, store, syntheticV2(), 1)
	if err := configuration.Activate(ctx, v2, 1); err != nil {
		t.Fatal(err)
	}
	doc, err = store.Get(ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := selectedConfiguration(ctx, store, doc)
	if err != nil || !reflect.DeepEqual(selected, v1.Payload.Data) {
		t.Fatalf("draft did not retain its original chart after activation: %v", err)
	}
	if err := doc.Post(selected); err != nil {
		t.Fatal(err)
	}
	if err := doc.attribute(context.WithValue(ctx, principalKey{}, "development:local"), "document.post"); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, doc, doc.Version); err != nil {
		t.Fatal(err)
	}

	doc, err = store.Get(ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	originalEntries := []Entry{{"1100", 4, 0}, {"4000", 0, 2}, {"2100", 0, 2}}
	if doc.Total-doc.Paid != 4 || doc.Status != "posted" ||
		!reflect.DeepEqual(doc.Entries, originalEntries) ||
		doc.FinancialSnapshot == nil || doc.FinancialSnapshot.Selection.VersionID == nil ||
		*doc.FinancialSnapshot.Selection.VersionID != v1.ID {
		t.Fatalf("posting changed legacy arithmetic or chart capture: %+v", doc)
	}
	if err := doc.RecordPayment(Payment{ID: "legacy-one-cent", Date: doc.Date, Amount: 1}); err != nil {
		t.Fatal(err)
	}
	if err := doc.attribute(context.WithValue(ctx, principalKey{}, "development:local"), "manual-payment.record"); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, doc, doc.Version); err != nil {
		t.Fatal(err)
	}
	paid, err := store.Get(ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if paid.Paid != 1 || paid.Total-paid.Paid != 3 ||
		!reflect.DeepEqual(paid.Entries, originalEntries) ||
		!reflect.DeepEqual(paid.Payments[0].Entries, []Entry{{"1000", 1, 0}, {"1100", 0, 1}}) ||
		paid.FinancialSnapshot == nil || paid.FinancialSnapshot.Selection.VersionID == nil ||
		*paid.FinancialSnapshot.Selection.VersionID != v1.ID {
		t.Fatalf("payment changed legacy outstanding balance or original chart meaning: %+v", paid)
	}
}
