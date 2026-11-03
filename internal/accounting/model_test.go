package accounting

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

var testCompany = primitive.NewObjectID()

func draft(kind string) Draft {
	code := "4000"
	if kind == "bill" {
		code = "5000"
	}
	return Draft{Kind: kind, Partner: "Example company", Date: "2026-11-03", DueDate: "2026-12-03",
		Lines: []Line{{Description: "Services", Quantity: 2, UnitCents: 10000, TaxBPS: 2100, AccountCode: code}}}
}

func TestPostingAndPayments(t *testing.T) {
	for _, kind := range []string{"invoice", "bill"} {
		t.Run(kind, func(t *testing.T) {
			doc, err := NewDocument(draft(kind), testCompany)
			if err != nil {
				t.Fatal(err)
			}
			if doc.Subtotal != 20000 || doc.Tax != 4200 || doc.Total != 24200 || doc.Status != "draft" || len(doc.Entries) != 0 {
				t.Fatalf("incorrect draft: %+v", doc)
			}
			if err := doc.RecordPayment(Payment{ID: "early", Date: doc.Date, Amount: 100}); !errors.Is(err, ErrInvalid) {
				t.Fatal("draft payment must fail")
			}
			if err := doc.Post(); err != nil || !Balanced(doc.Entries) {
				t.Fatalf("post: %v, entries: %+v", err, doc.Entries)
			}
			if err := doc.SetDraft(draft(kind)); !errors.Is(err, ErrInvalid) {
				t.Fatal("posted document must be immutable")
			}
			if err := doc.Post(); !errors.Is(err, ErrInvalid) {
				t.Fatal("duplicate posting must fail")
			}
			if err := doc.RecordPayment(Payment{ID: "p1", Date: doc.Date, Amount: 10000}); err != nil {
				t.Fatal(err)
			}
			if doc.Status != "posted" || doc.Paid != 10000 || !Balanced(doc.Payments[0].Entries) {
				t.Fatal("partial payment incorrect")
			}
			if err := doc.RecordPayment(Payment{ID: "p1", Date: doc.Date, Amount: 10000}); !errors.Is(err, ErrInvalid) {
				t.Fatal("duplicate payment must fail")
			}
			if err := doc.RecordPayment(Payment{ID: "large", Date: doc.Date, Amount: 14201}); !errors.Is(err, ErrInvalid) {
				t.Fatal("overpayment must fail")
			}
			if err := doc.RecordPayment(Payment{ID: "p2", Date: doc.Date, Amount: 14200}); err != nil {
				t.Fatal(err)
			}
			if doc.Status != "paid" || doc.Paid != doc.Total {
				t.Fatal("full payment did not settle document")
			}
			bank, control := int64(0), int64(0)
			for _, entry := range doc.Entries {
				if entry.AccountCode == "1100" || entry.AccountCode == "2000" {
					control += entry.Debit - entry.Credit
				}
			}
			for _, payment := range doc.Payments {
				for _, entry := range payment.Entries {
					if entry.AccountCode == "1000" {
						bank += entry.Debit - entry.Credit
					} else {
						control += entry.Debit - entry.Credit
					}
				}
			}
			expected := doc.Total
			if kind == "bill" {
				expected = -expected
			}
			if control != 0 || bank != expected {
				t.Fatalf("control=%d bank=%d expected=%d", control, bank, expected)
			}
		})
	}
}

func TestRoundingAndInputLimits(t *testing.T) {
	input := draft("invoice")
	input.Lines = []Line{{Description: "A", Quantity: 1, UnitCents: 5, TaxBPS: 1000, AccountCode: "4000"}, {Description: "B", Quantity: 1, UnitCents: 5, TaxBPS: 1000, AccountCode: "4000"}}
	doc, err := NewDocument(input, testCompany)
	if err != nil || doc.Tax != 2 || doc.Total != 12 {
		t.Fatalf("per-line half-up rounding failed: %+v %v", doc, err)
	}
	cases := []struct {
		name   string
		change func(*Draft)
	}{
		{"empty partner", func(d *Draft) { d.Partner = "  " }},
		{"kind", func(d *Draft) { d.Kind = "credit" }},
		{"invalid email", func(d *Draft) { d.Email = "not-an-address" }},
		{"invalid date", func(d *Draft) { d.Date = "2026-02-30" }},
		{"past due", func(d *Draft) { d.DueDate = "2026-01-01" }},
		{"empty lines", func(d *Draft) { d.Lines = nil }},
		{"too many lines", func(d *Draft) { d.Lines = make([]Line, 101) }},
		{"negative price", func(d *Draft) { d.Lines[0].UnitCents = -1 }},
		{"huge price", func(d *Draft) { d.Lines[0].UnitCents = 1_000_000_001 }},
		{"quantity zero", func(d *Draft) { d.Lines[0].Quantity = 0 }},
		{"quantity too large", func(d *Draft) { d.Lines[0].Quantity = 10001 }},
		{"tax negative", func(d *Draft) { d.Lines[0].TaxBPS = -1 }},
		{"tax too large", func(d *Draft) { d.Lines[0].TaxBPS = 10001 }},
		{"wrong account", func(d *Draft) { d.Lines[0].AccountCode = "1000" }},
		{"zero total", func(d *Draft) { d.Lines[0].UnitCents = 0 }},
		{"total limit", func(d *Draft) { d.Lines[0].Quantity = 10000; d.Lines[0].UnitCents = 1_000_000_000 }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := draft("invoice")
			tc.change(&input)
			if _, err := NewDocument(input, testCompany); !errors.Is(err, ErrInvalid) {
				t.Fatalf("expected invalid, got %v", err)
			}
		})
	}
	max := draft("invoice")
	max.Lines[0].Quantity, max.Lines[0].UnitCents, max.Lines[0].TaxBPS = 1000, 1_000_000_000, 0
	if doc, err := NewDocument(max, testCompany); err != nil || doc.Total != MaxAmount {
		t.Fatalf("exact maximum rejected: %v", err)
	}
	unicode := draft("invoice")
	unicode.Partner, unicode.Lines[0].Description = strings.Repeat("\u00e9", 200), strings.Repeat("\u00e9", 500)
	if _, err := NewDocument(unicode, testCompany); err != nil {
		t.Fatalf("character limits must support UTF-8 names: %v", err)
	}
}

func TestPaymentLimits(t *testing.T) {
	doc, _ := NewDocument(draft("invoice"), testCompany)
	if err := doc.Post(); err != nil {
		t.Fatal(err)
	}
	for _, payment := range []Payment{
		{ID: "zero", Date: doc.Date, Amount: 0},
		{ID: "negative", Date: doc.Date, Amount: -1},
		{ID: "early", Date: "2026-11-02", Amount: 1},
		{Date: doc.Date, Amount: 1},
	} {
		if err := doc.RecordPayment(payment); !errors.Is(err, ErrInvalid) {
			t.Fatalf("payment should be rejected: %+v", payment)
		}
	}
	for i := range 200 {
		if err := doc.RecordPayment(Payment{ID: fmt.Sprintf("p%d", i), Date: doc.Date, Amount: 1}); err != nil {
			t.Fatal(err)
		}
	}
	if err := doc.RecordPayment(Payment{ID: "p201", Date: doc.Date, Amount: 1}); !errors.Is(err, ErrInvalid) || len(doc.Payments) != 200 {
		t.Fatal("payment array cap must reject the 201st payment")
	}
}

func TestOwnershipCompatibility(t *testing.T) {
	owner, other := primitive.NewObjectID(), primitive.NewObjectID()
	doc := Document{OwnerID: owner}
	doc.NormalizeOwnership()
	if doc.OrganisationID != owner || doc.ProjectID != owner {
		t.Fatal("legacy owner must populate both axes")
	}
	doc = Document{OwnerID: owner, OrganisationID: other}
	doc.NormalizeOwnership()
	if doc.OrganisationID != other || doc.ProjectID != owner {
		t.Fatal("canonical ownership must not be overwritten")
	}
}

func TestMemoryCompareAndSwap(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()
	doc, _ := NewDocument(draft("invoice"), testCompany)
	if err := store.Create(ctx, doc); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Go(func() {
			copy := clone(doc)
			if err := copy.Post(); err != nil {
				results <- err
				return
			}
			results <- store.Save(ctx, copy, doc.Version)
		})
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("success=%d conflict=%d", success, conflict)
	}
	saved, _ := store.Get(ctx, doc.ID)
	saved.Lines[0].Description = "changed outside store"
	unchanged, _ := store.Get(ctx, doc.ID)
	if unchanged.Lines[0].Description == saved.Lines[0].Description {
		t.Fatal("memory store leaked mutable references")
	}
}
