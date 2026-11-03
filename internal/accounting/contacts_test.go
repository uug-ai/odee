package accounting

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

func sampleContact() ContactData {
	return ContactData{Name: "Example Contacts Ltd", IsCompany: true, Email: "books@example.invalid", Website: "example.invalid", Type: "contact", Active: true, Customer: true, Address: ContactAddress{Street: "1 Example Street", PostalCode: "1000", City: "Brussels", Country: "Belgium"}, Tags: []string{"Example"}}
}

func contactHandler() (http.Handler, *MemoryContacts) {
	contacts := NewMemoryContacts(testCompany)
	return (&Server{Store: NewMemoryStore(), Contacts: contacts, Company: testCompany, Dev: true, Origin: "http://localhost:8098"}).Handler(), contacts
}

func TestContactsCRUDAndValidation(t *testing.T) {
	handler, store := contactHandler()
	body, _ := json.Marshal(sampleContact())
	response := apiRequest(handler, "POST", "/api/contacts", string(body), "", "http://localhost:8098")
	if response.Code != 201 {
		t.Fatalf("create %d: %s", response.Code, response.Body)
	}
	var contact Contact
	if err := json.Unmarshal(response.Body.Bytes(), &contact); err != nil {
		t.Fatal(err)
	}
	if contact.Version != 1 || contact.Website != "https://example.invalid" || contact.Email != "books@example.invalid" || contact.Address.City != "Brussels" {
		t.Fatal("contact data not preserved")
	}
	contact.Active = false
	body, _ = json.Marshal(struct {
		ContactData
		Version int64 `json:"version"`
	}{contact.ContactData, contact.Version})
	path := "/api/contacts/" + contact.ID.Hex()
	if response := apiRequest(handler, "PUT", path, string(body), "", "http://localhost:8098"); response.Code != 200 {
		t.Fatalf("archive %d %s", response.Code, response.Body)
	}
	if response := apiRequest(handler, "PUT", path, string(body), "", "http://localhost:8098"); response.Code != 409 {
		t.Fatal("stale contact edit must conflict")
	}
	saved, err := store.Get(context.Background(), contact.ID)
	if err != nil || saved.Active || saved.Version != 2 {
		t.Fatal("archive did not persist")
	}
	for _, invalidContact := range []ContactData{{}, {Name: "Invalid", Email: "bad email"}, {Name: "Invalid", Website: "javascript:alert(1)"}, {Name: "Invalid", Type: "unknown"}, {Name: strings.Repeat("x", 201)}} {
		body, _ := json.Marshal(invalidContact)
		if response := apiRequest(handler, "POST", "/api/contacts", string(body), "", "http://localhost:8098"); response.Code != 422 {
			t.Fatalf("invalid contact accepted: %s", body)
		}
	}
	if response := apiRequest(handler, "POST", "/api/contacts", `{"name":"Spoof","organisationId":"spoof"}`, "", "http://localhost:8098"); response.Code != 400 {
		t.Fatal("ownership fields accepted from input")
	}
	token := strings.Repeat("a", 32)
	secured := (&Server{Store: NewMemoryStore(), Contacts: store, Company: testCompany, Token: token, Origin: "https://odee.example.invalid"}).Handler()
	if response := apiRequest(secured, "GET", "/api/contacts", "", "", ""); response.Code != 401 {
		t.Fatal("unauthenticated contact read allowed")
	}
	if response := apiRequest(secured, "POST", "/api/contacts", "{}", token, "https://other.invalid"); response.Code != 403 {
		t.Fatal("cross-origin contact creation allowed")
	}
}

func sampleContactImport() ContactImport {
	return ContactImport{Source: "https://odoo.example.invalid", Database: "test", Reviewed: true, Contacts: []OdooContactInput{
		{ContactData: sampleContact(), ExternalID: 11, CompanyID: 1},
		{ContactData: ContactData{Name: "Example Person", CompanyName: "Example Contacts Ltd", Active: true, Type: "contact", Email: "books@example.invalid"}, ExternalID: 12, ParentID: 11, CompanyID: 1},
	}}
}

func TestContactsImportIdempotencyAndLocalEdits(t *testing.T) {
	handler, store := contactHandler()
	input := sampleContactImport()
	input.Contacts[0].Website = "https:///example.invalid"
	body, _ := json.Marshal(input)
	response := apiRequest(handler, "POST", "/api/contacts/import", string(body), "", "http://localhost:8098")
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"created":2`) {
		t.Fatalf("import %d: %s", response.Code, response.Body)
	}
	items, err := store.List(context.Background())
	if err != nil || len(items) != 2 {
		t.Fatal("same-email contacts must remain distinct")
	}
	source := OdooContactSource{Origin: input.Source, Database: input.Database, ID: 11}
	company, err := store.ByOdoo(context.Background(), source)
	if err != nil || company.Odoo.CompanyID != 1 {
		t.Fatal("source provenance missing")
	}
	if company.Website != "https://example.invalid" || company.Odoo.OriginalWebsite != "https:///example.invalid" {
		t.Fatal("website normalization must retain the original source value")
	}
	company.Name = "Local edited name"
	if err := store.Save(context.Background(), company, company.Version); err != nil {
		t.Fatal(err)
	}
	response = apiRequest(handler, "POST", "/api/contacts/import", string(body), "", "http://localhost:8098")
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"skipped":2`) {
		t.Fatal("import retry must skip existing source IDs")
	}
	company, err = store.Get(context.Background(), company.ID)
	if err != nil || company.Name != "Local edited name" || company.Odoo.ID != 11 {
		t.Fatal("retry overwrote local edits or source identity")
	}
	input.Contacts[1].Name = ""
	input.Contacts[0].ExternalID = 30
	body, _ = json.Marshal(input)
	if response := apiRequest(handler, "POST", "/api/contacts/import", string(body), "", "http://localhost:8098"); response.Code != 422 {
		t.Fatal("invalid import accepted")
	}
	if _, err := store.ByOdoo(context.Background(), OdooContactSource{Origin: input.Source, Database: input.Database, ID: 30}); !errors.Is(err, ErrNotFound) {
		t.Fatal("validation must complete before any writes")
	}
	input = sampleContactImport()
	input.Reviewed = false
	body, _ = json.Marshal(input)
	if response := apiRequest(handler, "POST", "/api/contacts/import", string(body), "", "http://localhost:8098"); response.Code != 422 {
		t.Fatal("import confirmation required")
	}
	foreign := cloneContact(company)
	foreign.OrganisationID, foreign.ProjectID = primitive.NewObjectID(), primitive.NewObjectID()
	if err := store.Create(context.Background(), foreign); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign contact inserted")
	}
}
