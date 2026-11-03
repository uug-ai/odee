package accounting

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

const sampleText = "Supplier: Example Supplies Ltd\nInvoice number: EX-2026-001\nInvoice date: 03/11/2026\nDue date: 03/12/2026\nCurrency: EUR\nConsulting  2  100.00  21%  242.00\nSubtotal: 200.00\nVAT 21%: 42.00\nTotal: 242.00 EUR"

func samplePDF(text string) []byte {
	var commands strings.Builder
	commands.WriteString("BT /F1 14 Tf 40 780 Td 22 TL ")
	for i, line := range strings.Split(text, "\n") {
		if i > 0 {
			commands.WriteString("T* ")
		}
		line = strings.NewReplacer("\\", "\\\\", "(", "\\(", ")", "\\)").Replace(line)
		fmt.Fprintf(&commands, "(%s) Tj ", line)
	}
	commands.WriteString("ET")
	stream := commands.String()
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream),
	}
	var pdf bytes.Buffer
	pdf.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	for i, object := range objects {
		offsets = append(offsets, pdf.Len())
		fmt.Fprintf(&pdf, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := pdf.Len()
	fmt.Fprintf(&pdf, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return pdf.Bytes()
}

func uploadRequest(handler http.Handler, data []byte, filename, origin, token string) *httptest.ResponseRecorder {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", filename)
	_, _ = part.Write(data)
	_ = writer.Close()
	request := httptest.NewRequest("POST", "/api/imports", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Origin", origin)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, request)
	return w
}

func importResponse(t *testing.T, response *httptest.ResponseRecorder) (BillImport, bool) {
	t.Helper()
	var result struct {
		Import    BillImport `json:"import"`
		Duplicate bool       `json:"duplicate"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Import, result.Duplicate
}

func TestExtractBill(t *testing.T) {
	scan := extract(sampleText)
	if scan.Draft.Partner != "Example Supplies Ltd" || scan.Draft.Reference != "EX-2026-001" || scan.Draft.Date != "2026-11-03" || scan.Draft.DueDate != "2026-12-03" || scan.Currency != "EUR" {
		t.Fatalf("fields were not extracted: %+v", scan)
	}
	if scan.Subtotal != 20000 || scan.Tax != 4200 || scan.Total != 24200 || len(scan.Draft.Lines) != 1 || scan.Draft.Lines[0].Quantity != 2 {
		t.Fatalf("line items and exact totals incorrect: %+v", scan)
	}
	doc, err := NewDocument(scan.Draft, testCompany)
	if err != nil || doc.Total != scan.Total {
		t.Fatalf("prefilled draft totals: %+v, %v", doc, err)
	}
	for value, expected := range map[string]int64{"1.234,56": 123456, "1,234.56": 123456, "1 234,56": 123456, "0.29": 29, "10000000000.00": MaxAmount} {
		if amount, ok := parseAmount(value); !ok || amount != expected {
			t.Fatalf("amount %q: %d %v", value, amount, ok)
		}
	}
	for _, value := range []string{"-10.00", "1.001", "1e5", "NaN", "10000000000.01"} {
		if _, ok := parseAmount(value); ok {
			t.Fatalf("invalid amount %q accepted", value)
		}
		for _, value := range []string{"1.2.34", "1.234.56", "1,23.45"} {
			if _, ok := parseAmount(value); ok {
				t.Fatalf("malformed grouping %q accepted", value)
			}
		}
		for rate, expected := range map[string]int64{"20.5": 2050, "20,5": 2050, "7.25": 725, "100": 10000, "0": 0} {
			if bps, ok := parseRate(rate); !ok || bps != expected {
				t.Fatalf("VAT rate %q: %d %v", rate, bps, ok)
			}
		}
		if field("Supplier:Example", "supplier") != "Example" || extractedDate("2026/1/2") != "2026-01-02" {
			t.Fatal("compact labels or ISO dates not extracted")
		}
	}
	summary := extract(strings.ReplaceAll(sampleText, "Consulting  2  100.00  21%  242.00\n", ""))
	if summary.Draft.Lines[0].UnitCents != 20000 || summary.Draft.Lines[0].TaxBPS != 2100 || len(summary.Warnings) == 0 {
		t.Fatal("summary line must be explicit and reconcile")
	}
	mismatch := extract(strings.ReplaceAll(sampleText, "Total: 242.00", "Total: 250.00"))
	if mismatch.Draft.Lines[0].UnitCents != 0 || !strings.Contains(strings.Join(mismatch.Warnings, " "), "does not equal") {
		t.Fatal("unreconciled OCR amounts must not silently become invoice lines")
	}
	missing := extract("Supplier: Example\nInvoice number: X\nTotal: 50.00")
	if missing.Draft.Date != "" || missing.Draft.Lines[0].UnitCents != 0 || len(missing.Warnings) < 3 {
		t.Fatal("missing fields must remain missing and be flagged")
	}
	foreign := extract(strings.ReplaceAll(sampleText, "EUR", "USD"))
	if foreign.Currency != "USD" {
		t.Fatal("unsupported currency not detected")
	}
}

func TestLocalScannerPDF(t *testing.T) {
	scanner := NewScanner("eng")
	if err := scanner.Ready(); err != nil {
		t.Skip(err)
	}
	scan, err := scanner.Scan(context.Background(), samplePDF(sampleText), "application/pdf")
	if err != nil || scan.Total != 24200 || scan.Method != "pdf text" || scan.Pages != 1 {
		t.Fatalf("digital PDF scan: %+v %v", scan, err)
	}
	preview, contentType, err := scanner.Preview(context.Background(), samplePDF(sampleText), "application/pdf", 1)
	if err != nil || contentType != "image/png" || !bytes.HasPrefix(preview, []byte("\x89PNG")) {
		t.Fatalf("PDF preview: %s %v", contentType, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := scanner.Scan(ctx, samplePDF(sampleText), "application/pdf"); err == nil {
		t.Fatal("cancelled scan must fail")
	}
}

func TestLocalScannerFixtures(t *testing.T) {
	dir := os.Getenv("ODEE_TEST_FIXTURES")
	if dir == "" {
		t.Skip("run npm run test:scans for generated image/scanned-PDF fixtures")
	}
	scanner := NewScanner("eng+nld+fra")
	if err := scanner.Ready(); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct{ name, contentType string }{{"bill.png", "image/png"}, {"bill.jpg", "image/jpeg"}, {"scanned.pdf", "application/pdf"}, {"hybrid.pdf", "application/pdf"}} {
		t.Run(fixture.name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(dir, fixture.name))
			if err != nil {
				t.Fatal(err)
			}
			scan, err := scanner.Scan(context.Background(), data, fixture.contentType)
			if err != nil {
				t.Fatal(err)
			}
			if scan.Total != 24200 || scan.Subtotal != 20000 || scan.Tax != 4200 || scan.Draft.Date != "2026-11-03" || scan.Draft.Reference != "EX-2026-001" {
				t.Fatalf("OCR failed required fields/amounts: %+v", scan)
			}
		})
	}
	tooMany, err := os.ReadFile(filepath.Join(dir, "too-many.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scanner.Scan(context.Background(), tooMany, "application/pdf"); err == nil || !strings.Contains(err.Error(), "1 to 10 pages") {
		t.Fatal("page limit was not enforced")
	}
}

func TestBillUploadReviewAndDuplicates(t *testing.T) {
	scanner := NewScanner("eng")
	if err := scanner.Ready(); err != nil {
		t.Skip(err)
	}
	origin := "http://localhost:8098"
	store, originals := NewMemoryStore(), NewMemoryImports(testCompany)
	handler := (&Server{Store: store, Imports: originals, Scanner: scanner, Company: testCompany, Dev: true, Origin: origin}).Handler()
	data := samplePDF(sampleText)
	response := uploadRequest(handler, data, "bill.pdf", origin, "")
	if response.Code != 201 {
		t.Fatalf("upload %d: %s", response.Code, response.Body)
	}
	item, duplicate := importResponse(t, response)
	if duplicate || item.Status != "ready" || item.Scan.Total != 24200 {
		t.Fatalf("scan response: %+v", item)
	}
	if docs, _ := store.List(context.Background()); len(docs) != 0 {
		t.Fatal("upload must not create/post/pay a bill")
	}
	path := "/api/imports/" + item.ID.Hex()
	body, _ := json.Marshal(struct {
		Draft
		Reviewed       bool `json:"reviewed"`
		AcceptMismatch bool `json:"acceptMismatch"`
	}{Draft: item.Scan.Draft})
	response = apiRequest(handler, "POST", path+"/draft", string(body), "", origin)
	if response.Code != 422 {
		t.Fatal("review acknowledgement must be required")
	}
	body, _ = json.Marshal(struct {
		Draft
		Reviewed bool `json:"reviewed"`
	}{item.Scan.Draft, true})
	response = apiRequest(handler, "POST", path+"/draft", string(body), "", origin)
	if response.Code != 201 {
		t.Fatalf("draft %d: %s", response.Code, response.Body)
	}
	var doc Document
	if err := json.Unmarshal(response.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Status != "draft" || doc.Paid != 0 || len(doc.Entries) != 0 || doc.SourceID == nil || *doc.SourceID != item.ID {
		t.Fatal("review must create only an attached draft")
	}
	response = apiRequest(handler, "POST", path+"/draft", string(body), "", origin)
	if response.Code != 200 {
		t.Fatalf("review retry %d: %s", response.Code, response.Body)
	}
	if docs, _ := store.List(context.Background()); len(docs) != 1 {
		t.Fatal("review retry created a duplicate bill")
	}
	response = uploadRequest(handler, data, "same-original.pdf", origin, "")
	repeated, duplicate := importResponse(t, response)
	if response.Code != 200 || !duplicate || repeated.ID != item.ID {
		t.Fatal("exact duplicate must reuse the original")
	}
	response = apiRequest(handler, "GET", path+"/original", "", "", "")
	if response.Code != 200 || !bytes.Equal(response.Body.Bytes(), data) || !strings.Contains(response.Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("original bytes must be preserved")
	}
	otherCopy := append(append([]byte{}, data...), []byte("\n% alternate copy")...)
	response = uploadRequest(handler, otherCopy, "copy.pdf", origin, "")
	alternate, _ := importResponse(t, response)
	if !strings.Contains(strings.Join(alternate.Scan.Warnings, " "), "Possible duplicate") {
		t.Fatal("supplier/invoice-number duplicate not flagged")
	}
}

func TestUploadFailureAndLimits(t *testing.T) {
	origin := "http://localhost:8098"
	originals := NewMemoryImports(testCompany)
	handler := (&Server{Store: NewMemoryStore(), Imports: originals, Scanner: NewScanner("eng"), Company: testCompany, Dev: true, Origin: origin}).Handler()
	invalidPDF := []byte("%PDF-not-a-valid-document")
	response := uploadRequest(handler, invalidPDF, "broken.pdf", origin, "")
	item, _ := importResponse(t, response)
	if response.Code != 201 || item.Status != "failed" || item.Error == "" {
		t.Fatal("failed scan must be explicit and retain the original")
	}
	retained, err := originals.Bytes(context.Background(), item.ID)
	if err != nil || !bytes.Equal(retained, invalidPDF) {
		t.Fatal("failed scan lost original")
	}
	if response := uploadRequest(handler, []byte("<script>not an invoice</script>"), "fake.pdf", origin, ""); response.Code != 422 {
		t.Fatal("content type must be validated using bytes")
	}
	if response := uploadRequest(handler, make([]byte, MaxFileBytes+1), "large.pdf", origin, ""); response.Code != 413 {
		t.Fatal("file-size limit not enforced")
	}
	var oversized bytes.Buffer
	if err := png.Encode(&oversized, image.NewGray(image.Rect(0, 0, 20001, 1))); err != nil {
		t.Fatal(err)
	}
	if _, err := fileType(oversized.Bytes()); err == nil {
		t.Fatal("image dimension cap not enforced")
	}
	token := strings.Repeat("a", 32)
	secured := (&Server{Store: NewMemoryStore(), Imports: originals, Scanner: NewScanner("eng"), Company: testCompany, Token: token, Origin: origin}).Handler()
	if response := uploadRequest(secured, invalidPDF, "broken.pdf", origin, ""); response.Code != 401 {
		t.Fatal("unauthenticated upload allowed")
	}
	if response := apiRequest(secured, "GET", "/api/imports/"+item.ID.Hex()+"/original", "", "", ""); response.Code != 401 {
		t.Fatal("unauthenticated original download allowed")
	}
}

func importMetadata(company primitive.ObjectID, data []byte) BillImport {
	hash := sha256.Sum256(data)
	now := time.Now().UTC()
	return BillImport{ID: primitive.NewObjectID(), OrganisationID: company, ProjectID: company, Filename: "original.pdf", ContentType: "application/pdf", SHA256: hex.EncodeToString(hash[:]), Size: int64(len(data)), Status: "pending", Version: 1, Scan: emptyScan(), CreatedAt: now, UpdatedAt: now}
}

func TestImportReviewGuardrailsAndManualRecovery(t *testing.T) {
	ctx, origin := context.Background(), "http://localhost:8098"
	store, originals := NewMemoryStore(), NewMemoryImports(testCompany)
	handler := (&Server{Store: store, Imports: originals, Company: testCompany, Dev: true, Origin: origin}).Handler()
	data := samplePDF(sampleText)
	item := importMetadata(testCompany, data)
	item.Status, item.Scan = "ready", extract(sampleText)
	item.Scan.Total++
	if err := originals.Upload(ctx, item, data); err != nil {
		t.Fatal(err)
	}
	payload := struct {
		Draft
		Reviewed       bool `json:"reviewed"`
		AcceptMismatch bool `json:"acceptMismatch"`
	}{item.Scan.Draft, true, false}
	body, _ := json.Marshal(payload)
	path := "/api/imports/" + item.ID.Hex() + "/draft"
	if response := apiRequest(handler, "POST", path, string(body), "", origin); response.Code != 422 {
		t.Fatal("scan-total discrepancy must require explicit acknowledgement")
	}
	payload.AcceptMismatch = true
	body, _ = json.Marshal(payload)
	if response := apiRequest(handler, "POST", path, string(body), "", origin); response.Code != 201 {
		t.Fatalf("explicit corrected total: %d %s", response.Code, response.Body)
	}
	foreignData := append(append([]byte{}, data...), []byte("\n% foreign")...)
	foreign := importMetadata(testCompany, foreignData)
	foreign.Status, foreign.Scan = "ready", extract(strings.ReplaceAll(sampleText, "EUR", "CAD"))
	if foreign.Scan.Currency != "CAD" {
		t.Fatal("explicit foreign currency not detected")
	}
	if err := originals.Upload(ctx, foreign, foreignData); err != nil {
		t.Fatal(err)
	}
	if response := apiRequest(handler, "POST", "/api/imports/"+foreign.ID.Hex()+"/draft", string(body), "", origin); response.Code != 422 {
		t.Fatal("foreign-currency original converted to EUR bill")
	}
	failedData := append(append([]byte{}, data...), []byte("\n% manual")...)
	response := uploadRequest(handler, failedData, "manual.pdf", origin, "")
	failed, _ := importResponse(t, response)
	if response.Code != 201 || failed.Status != "failed" {
		t.Fatal("unavailable OCR must still retain original")
	}
	payload.Draft, payload.AcceptMismatch = draft("bill"), false
	body, _ = json.Marshal(payload)
	if response := apiRequest(handler, "POST", "/api/imports/"+failed.ID.Hex()+"/draft", string(body), "", origin); response.Code != 201 {
		t.Fatalf("manual recovery: %d %s", response.Code, response.Body)
	}
	for _, id := range []primitive.ObjectID{item.ID, failed.ID} {
		doc, err := store.Get(ctx, id)
		if err != nil || doc.Status != "draft" || len(doc.Entries) != 0 || len(doc.Payments) != 0 {
			t.Fatal("review must never post or pay", err)
		}
	}
	server := &Server{Store: store, Imports: originals, Company: testCompany, Dev: true, Origin: origin}
	limited := server.Handler()
	server.uploadSlots <- struct{}{}
	server.uploadSlots <- struct{}{}
	if response := uploadRequest(limited, data, "busy.pdf", origin, ""); response.Code != 429 {
		t.Fatal("server upload concurrency cap not enforced")
	}
}
