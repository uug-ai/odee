package accounting

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const paidBillText = `Supplier: Example Services Ltd
Invoice number: PAID-EXAMPLE-001
Invoice date: 03/11/2026
Currency: EUR

Omschrijving                  Aantal       Prijs        BTW       Bedrag
Managed service               2            100,00       21%       200,00

                                           Totaal excl. BTW      200,00
                                           Totaal BTW             42,00
                                           Totaal incl. BTW    € 0.242,00
BTW       Basis       Bedrag               Reeds betaald         -242,00
21 %      200,00       42,00
                                           Te betalen         € 0.000,00`

func TestExtractPaidBillKeepsInvoiceTotalAndLines(t *testing.T) {
	requirePaidBillScan(t, extract(paidBillText))
}

func requirePaidBillScan(t *testing.T, scan Scan) {
	t.Helper()
	if scan.Subtotal != 20000 || !scan.TaxKnown || scan.Tax != 4200 || scan.Total != 24200 {
		t.Fatalf("invoice amounts were confused with payment columns: %+v", scan)
	}
	if len(scan.Draft.Lines) != 1 {
		t.Fatalf("expected the original bill line, got %+v", scan.Draft.Lines)
	}
	line := scan.Draft.Lines[0]
	if line.Description != "Managed service" || line.Quantity != 2 || line.UnitCents != 10000 || line.TaxBPS != 2100 {
		t.Fatalf("bill line was not populated: %+v", line)
	}
	doc, err := NewDocument(scan.Draft, testCompany)
	if err != nil || doc.Subtotal != scan.Subtotal || doc.Tax != scan.Tax || doc.Total != scan.Total {
		t.Fatalf("proposed line does not reconcile: %+v %v", doc, err)
	}
	if doc.Paid != 0 || len(doc.Payments) != 0 || len(doc.Entries) != 0 || doc.Status != "draft" {
		t.Fatalf("payment balance must not post or pay the bill: %+v", doc)
	}
	if !strings.Contains(strings.Join(scan.Warnings, " "), "Verify prior payments separately") {
		t.Fatal("a different balance due must be explained for manual review")
	}
}

func TestLocalScannerPaidBillFixture(t *testing.T) {
	directory := os.Getenv("ODEE_TEST_FIXTURES")
	if directory == "" {
		t.Skip("run npm run test:scans for generated PDF fixtures")
	}
	data, err := os.ReadFile(filepath.Join(directory, "paid.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	scan, err := NewScanner("eng+nld+fra").Scan(context.Background(), data, "application/pdf")
	if err != nil {
		t.Fatal(err)
	}
	requirePaidBillScan(t, scan)
}

func TestExtractInvoiceAmountLabels(t *testing.T) {
	for _, test := range []struct {
		name, totals string
	}{
		{"Dutch", "Totaal excl. BTW 200,00\nTotaal BTW 42,00\nTotaal incl. BTW EUR 242,00\nTe betalen 0,00"},
		{"English", "Subtotal: 200.00\nVAT 21%: 42.00\nGrand total: 242.00 EUR\nBalance due: 0.00"},
		{"French", "Montant HT: 200,00\nTVA 21 %: 42,00\nTotal TTC: 242,00"},
		{"partial payment", "Net amount: 200.00\nTotal VAT: 42.00\nInvoice total: 242.00\nAmount due: 100.00"},
		{"legacy due only", "VAT: 42.00\nTotal due: 242.00"},
	} {
		t.Run(test.name, func(t *testing.T) {
			scan := extract("Supplier: Example\nCurrency: EUR\n" + test.totals)
			if scan.Subtotal != 20000 || !scan.TaxKnown || scan.Tax != 4200 || scan.Total != 24200 ||
				scan.Draft.Lines[0].UnitCents != 20000 || scan.Draft.Lines[0].TaxBPS != 2100 {
				t.Fatalf("labelled amounts did not produce a reconciled summary: %+v", scan)
			}
		})
	}
}

func TestLabelledAmountDoesNotReadAnotherColumnOrNegativeAmount(t *testing.T) {
	for _, text := range []string{
		"VAT    Base    Amount                       Paid -242.00",
		"VAT number BE1234567890      Total 242.00",
		"VAT: -42.00",
		"VAT: 1.234.56",
		"VAT: 1,23.45",
		"VAT: 42.001",
	} {
		if amount, found := labelledAmount(text, `vat`); found {
			t.Fatalf("unrelated or invalid VAT amount accepted from %q: %d", text, amount)
		}
	}
	for _, text := range []string{"VAT: EUR 1.234,56", "VAT: 1 234,56", "VAT:\u00a01\u202f234,56"} {
		if amount, found := labelledAmount(text, `vat`); !found || amount != 123456 {
			t.Fatalf("grouped amount was not read: %q, %d %v", text, amount, found)
		}
	}
}
