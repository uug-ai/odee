package accounting

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func snapshotServer(t *testing.T, persistent bool) *Server {
	t.Helper()
	company := primitive.NewObjectID()
	s := &Server{Company: company, Dev: true, Origin: "http://127.0.0.1:19007",
		Store: NewMemoryStore(), Contacts: NewMemoryContacts(company), Profiles: NewMemoryCompany(company)}
	grant, _ := json.Marshal([]Grant{{Principal: "development:local", CompanyID: company, Capabilities: []Capability{Read, Write, Post, Admin}}})
	s.Authorization, _ = ParseAuthorization("enforced", string(grant))
	if persistent {
		uri := os.Getenv("ODEE_TEST_MONGODB_URI")
		if uri == "" {
			t.Skip("requires disposable MongoDB: npm --prefix web run test:mongo")
		}
		store, err := OpenMongo(context.Background(), uri, "odee_test_snapshots_"+primitive.NewObjectID().Hex(), company)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { store.Client.Disconnect(context.Background()) })
		s.Store, s.Profiles = store, NewMongoCompany(store)
		s.Contacts, err = NewMongoContacts(context.Background(), store)
		if err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func snapshotCall(t *testing.T, s *Server, method, path string, body any, status int, result any) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	response := apiRequest(s.Handler(), method, "/api/"+path, string(raw), "", s.Origin)
	if response.Code != status {
		t.Fatalf("%s %s: got %d want %d: %s", method, path, response.Code, status, response.Body)
	}
	if result != nil {
		if err := json.Unmarshal(response.Body.Bytes(), result); err != nil {
			t.Fatal(err)
		}
	}
}

func snapshotInput(doc Document) map[string]any {
	return map[string]any{"kind": doc.Kind, "partner": doc.Partner, "email": doc.Email, "reference": doc.Reference,
		"date": doc.Date, "dueDate": doc.DueDate, "lines": doc.Lines, "version": doc.Version}
}

func TestSnapshotLifecycleMemory(t *testing.T) { snapshotLifecycle(t, snapshotServer(t, false)) }
func TestSnapshotLifecycleMongo(t *testing.T)  { snapshotLifecycle(t, snapshotServer(t, true)) }

func snapshotLifecycle(t *testing.T, s *Server) {
	ctx := context.Background()
	data := sampleContact()
	data.Address.Country, data.VAT = "BE", "BE0123456749"
	data.AccountingMetadata = AccountingMetadata{EnterpriseID: "0123456749", BankAccount: "BE68539007547034", BIC: "TESTBEBB", PaymentTerms: "30 days", TaxApplicability: "unknown"}
	var profile CompanyProfile
	snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": 0, "data": data}, 200, &profile)
	var contact Contact
	snapshotCall(t, s, "POST", "contacts", data, 201, &contact)
	create := map[string]any{}
	raw, _ := json.Marshal(draft("invoice"))
	json.Unmarshal(raw, &create)
	create["partnerAction"], create["contactId"], create["expectedContactVersion"] = "select", contact.ID.Hex(), contact.Version
	var doc Document
	snapshotCall(t, s, "POST", "documents", create, 201, &doc)
	path := "documents/" + doc.ID.Hex()
	if doc.PartnerSnapshot == nil || doc.OwnCompanySnapshot == nil ||
		doc.PartnerSnapshot.SourceVersion != 1 || doc.PartnerSnapshot.SchemaVersion != 1 ||
		doc.PartnerSnapshot.ContactID != contact.ID || doc.PartnerSnapshot.Data.BankAccount != data.BankAccount ||
		doc.OwnCompanySnapshot.Role != "seller" || doc.OwnCompanySnapshot.SourceVersion != 1 {
		t.Fatalf("missing captures: %+v", doc)
	}
	original, _ := s.Store.Get(ctx, doc.ID)
	reject := func(input map[string]any, status int) {
		t.Helper()
		before, _ := s.Store.Get(ctx, doc.ID)
		snapshotCall(t, s, "PUT", path, input, status, nil)
		after, _ := s.Store.Get(ctx, doc.ID)
		if !reflect.DeepEqual(before, after) {
			t.Fatal("rejected update changed stored document or audit")
		}
	}
	input := snapshotInput(doc)
	input["partner"] = "forged"
	reject(input, 422)
	input = snapshotInput(doc)
	input["partnerSnapshot"] = doc.PartnerSnapshot
	reject(input, 400)
	for _, selection := range []map[string]any{
		{"partnerAction": "select"}, {"partnerAction": "select", "contactId": "bad", "expectedContactVersion": 1},
		{"contactId": contact.ID.Hex(), "expectedContactVersion": 1},
	} {
		input = snapshotInput(doc)
		for k, v := range selection {
			input[k] = v
		}
		reject(input, 422)
	}
	// Contact and own-company edits never resolve or overwrite captures on ordinary saves.
	updated := contact.ContactData
	updated.Name, updated.BankAccount, updated.Tags = "New partner", "BE62510007547061", []string{"New"}
	snapshotCall(t, s, "PUT", "contacts/"+contact.ID.Hex(), map[string]any{"version": 1, "name": updated.Name,
		"isCompany": updated.IsCompany, "email": updated.Email, "website": updated.Website, "active": true,
		"address": updated.Address, "tags": updated.Tags, "vat": updated.VAT, "bankAccount": updated.BankAccount,
		"enterpriseId": updated.EnterpriseID, "paymentTerms": updated.PaymentTerms}, 200, &contact)
	data.Name = "New own company"
	snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": 1, "data": data}, 200, &profile)
	snapshotCall(t, s, "PUT", path, snapshotInput(doc), 200, &doc)
	if !reflect.DeepEqual(doc.PartnerSnapshot, original.PartnerSnapshot) || !reflect.DeepEqual(doc.OwnCompanySnapshot, original.OwnCompanySnapshot) {
		t.Fatal("ordinary save refreshed captured identity")
	}
	input = snapshotInput(doc)
	input["partnerAction"], input["contactId"], input["expectedContactVersion"] = "refresh", contact.ID.Hex(), 1
	reject(input, 409) // current document, stale contact
	input["expectedContactVersion"], input["version"] = contact.Version, 1
	reject(input, 409) // current contact, stale document
	input["version"] = doc.Version
	input["ownCompanyAction"], input["expectedCompanyVersion"] = "refresh", 1
	reject(input, 409) // own profile stale, no partial partner refresh
	input["expectedCompanyVersion"] = profile.Version
	snapshotCall(t, s, "PUT", path, input, 200, &doc)
	if doc.PartnerSnapshot.SourceVersion != 2 || doc.Partner != "New partner" ||
		doc.OwnCompanySnapshot.SourceVersion != 2 || doc.OwnCompanySnapshot.Data.Name != "New own company" {
		t.Fatal("explicit refresh not captured")
	}
	// Copies returned by stores cannot mutate persisted snapshots.
	copy, _ := s.Store.Get(ctx, doc.ID)
	copy.PartnerSnapshot.Data.Tags[0] = "MUTATED"
	copy.OwnCompanySnapshot.Data.Tags[0] = "MUTATED"
	stored, _ := s.Store.Get(ctx, doc.ID)
	if stored.PartnerSnapshot.Data.Tags[0] == "MUTATED" || stored.OwnCompanySnapshot.Data.Tags[0] == "MUTATED" {
		t.Fatal("shared mutable snapshot aliases")
	}
	contact.Active = false
	snapshotCall(t, s, "PUT", "contacts/"+contact.ID.Hex(), map[string]any{"version": contact.Version, "ContactData": nil}, 400, nil)
	snapshotCall(t, s, "PUT", "contacts/"+contact.ID.Hex(), struct {
		ContactData
		Version int64 `json:"version"`
	}{contact.ContactData, contact.Version}, 200, &contact)
	input = snapshotInput(doc)
	input["partnerAction"], input["contactId"], input["expectedContactVersion"] = "refresh", contact.ID.Hex(), contact.Version
	reject(input, 422)
	// Posting freezes persisted captures, including an archived source.
	snapshotCall(t, s, "POST", path+"/post", map[string]any{"version": doc.Version}, 200, &doc)
	frozen := clone(doc)
	data.Name = "Yet another company"
	snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": profile.Version, "data": data}, 200, &profile)
	input = snapshotInput(doc)
	input["ownCompanyAction"], input["expectedCompanyVersion"] = "refresh", profile.Version
	reject(input, 422)
	snapshotCall(t, s, "POST", path+"/payments", map[string]any{"version": doc.Version, "id": "snapshot-payment", "date": doc.Date, "amount": doc.Total}, 200, &doc)
	if !reflect.DeepEqual(frozen.PartnerSnapshot, doc.PartnerSnapshot) || !reflect.DeepEqual(frozen.OwnCompanySnapshot, doc.OwnCompanySnapshot) {
		t.Fatal("payment changed frozen captures")
	}
	if got, _ := s.Store.Get(ctx, doc.ID); len(got.FinancialEvents) != 2 {
		t.Fatal("financial audit lost")
	}
	// Manual conversion retains metadata while explicitly removing the reference.
	contact.Active = true
	snapshotCall(t, s, "PUT", "contacts/"+contact.ID.Hex(), struct {
		ContactData
		Version int64 `json:"version"`
	}{contact.ContactData, contact.Version}, 200, &contact)
	create["expectedContactVersion"] = contact.Version
	var manual Document
	snapshotCall(t, s, "POST", "documents", create, 201, &manual)
	input = snapshotInput(manual)
	input["partnerAction"], input["partner"] = "manual", "Manually edited"
	snapshotCall(t, s, "PUT", "documents/"+manual.ID.Hex(), input, 200, &manual)
	if manual.Partner != "Manually edited" || !manual.PartnerSnapshot.ContactID.IsZero() || manual.PartnerSnapshot.Data.BankAccount != contact.BankAccount {
		t.Fatal("manual conversion lost known fields or retained reference")
	}
	input = snapshotInput(manual)
	input["partner"] = "Further manual edit"
	snapshotCall(t, s, "PUT", "documents/"+manual.ID.Hex(), input, 200, &manual)
	if manual.PartnerSnapshot.Data.Name != manual.Partner {
		t.Fatal("manual snapshot is inconsistent")
	}
	replacement := sampleContact()
	replacement.Name = "Explicitly reselected partner"
	var second Contact
	snapshotCall(t, s, "POST", "contacts", replacement, 201, &second)
	input = snapshotInput(manual)
	input["partnerAction"], input["contactId"], input["expectedContactVersion"] = "select", second.ID.Hex(), second.Version
	snapshotCall(t, s, "PUT", "documents/"+manual.ID.Hex(), input, 200, &manual)
	if manual.Partner != replacement.Name || manual.PartnerSnapshot.ContactID != second.ID || manual.PartnerSnapshot.SourceVersion != second.Version {
		t.Fatal("explicit reselection did not replace manual capture")
	}
	// No-profile manual and pre-feature documents remain postable/payable.
	s.Profiles = nil
	for _, kind := range []string{"invoice", "bill"} {
		var legacy Document
		snapshotCall(t, s, "POST", "documents", draft(kind), 201, &legacy)
		if legacy.OwnCompanySnapshot != nil || legacy.PartnerSnapshot != nil {
			t.Fatal("invented history")
		}
		snapshotCall(t, s, "PUT", "documents/"+legacy.ID.Hex(), snapshotInput(legacy), 200, &legacy)
		snapshotCall(t, s, "POST", "documents/"+legacy.ID.Hex()+"/post", map[string]any{"version": legacy.Version}, 200, &legacy)
		snapshotCall(t, s, "POST", "documents/"+legacy.ID.Hex()+"/payments", map[string]any{"version": legacy.Version, "id": "historical", "date": legacy.Date, "amount": legacy.Total}, 200, &legacy)
	}
}

func TestCompanyProfilePermissionsAndValidation(t *testing.T) {
	s := snapshotServer(t, false)
	for _, grants := range [][]Capability{nil, {Admin}, {Write}, {Post}, {Read}, {Read, Write}, {Read, Post}, {Read, Admin}} {
		raw, _ := json.Marshal([]Grant{{Principal: "development:local", CompanyID: s.Company, Capabilities: append([]Capability{}, grants...)}})
		s.Authorization, _ = ParseAuthorization("enforced", string(raw))
		access := s.Authorization.access("development:local", s.Company)
		read, mutate := 403, 403
		if access.allows(Read) {
			read = 200
		}
		if access.allows(Read, Admin) {
			mutate = 200
		}
		snapshotCall(t, s, "GET", "company-profile", nil, read, nil)
		version := int64(0)
		if p, err := s.Profiles.Get(context.Background()); err == nil {
			version = p.Version
		}
		snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": version, "data": sampleContact()}, mutate, nil)
	}
	grant, _ := json.Marshal([]Grant{{Principal: "development:local", CompanyID: s.Company, Capabilities: []Capability{Read, Write, Post, Admin}}})
	s.Authorization, _ = ParseAuthorization("enforced", string(grant))
	before, _ := s.Profiles.Get(context.Background())
	for _, patch := range []AccountingMetadata{
		{EnterpriseID: "0123456789"}, {BankAccount: "BE00539007547034"}, {TaxApplicability: "eligible"}, {BIC: strings.Repeat("x", 301)},
	} {
		data := sampleContact()
		data.Address.Country, data.AccountingMetadata = "BE", patch
		snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": before.Version, "data": data}, 422, nil)
		after, _ := s.Profiles.Get(context.Background())
		if !reflect.DeepEqual(before, after) {
			t.Fatal("invalid metadata changed saved profile")
		}
	}
	// Existing unassessed imports are not discarded or blocked by new identifier checks.
	data := sampleContact()
	data.Address.Country, data.VAT, data.EnterpriseID = "BE", "imported historic VAT", "imported historic ID"
	data.BIC, data.PaymentTerms = "historic unassessed BIC", strings.Repeat("x", 350)
	item, _ := newContact(data, s.Company)
	s.Contacts.Create(context.Background(), item)
	snapshotCall(t, s, "PUT", "contacts/"+item.ID.Hex(), struct {
		ContactData
		Version int64 `json:"version"`
	}{data, 1}, 200, nil)
	// Older clients omitting the new metadata cannot silently clear it.
	snapshotCall(t, s, "PUT", "contacts/"+item.ID.Hex(), map[string]any{
		"version": 2, "name": data.Name, "vat": data.VAT, "address": data.Address, "active": true,
	}, 200, nil)
	saved, _ := s.Contacts.Get(context.Background(), item.ID)
	if saved.PaymentTerms != data.PaymentTerms || saved.BIC != data.BIC || saved.EnterpriseID != data.EnterpriseID {
		t.Fatal("omitted accounting metadata erased known imported fields")
	}
}

func TestReviewDraftCapturesCompanyAndPartner(t *testing.T) {
	for _, persistent := range []bool{false, true} {
		t.Run(fmt.Sprint(persistent), func(t *testing.T) {
			s := snapshotServer(t, persistent)
			ctx := context.Background()
			if persistent {
				var err error
				s.Imports, err = NewMongoImports(ctx, s.Store.(*MongoStore))
				if err != nil {
					t.Fatal(err)
				}
			} else {
				s.Imports = NewMemoryImports(s.Company)
			}
			data := sampleContact()
			var profile CompanyProfile
			snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": 0, "data": data}, 200, &profile)
			var c Contact
			snapshotCall(t, s, "POST", "contacts", data, 201, &c)
			for _, selected := range []bool{false, true} {
				raw := []byte(fmt.Sprintf("synthetic original %v", selected))
				item := importMetadata(s.Company, raw)
				item.Status = "failed" // manual review remains possible without OCR.
				if err := s.Imports.Upload(ctx, item, raw); err != nil {
					t.Fatal(err)
				}
				input := map[string]any{}
				encoded, _ := json.Marshal(draft("bill"))
				json.Unmarshal(encoded, &input)
				input["reviewed"] = true
				if selected {
					input["partnerAction"], input["contactId"], input["expectedContactVersion"] = "select", c.ID.Hex(), c.Version
				}
				var doc Document
				snapshotCall(t, s, "POST", "imports/"+item.ID.Hex()+"/draft", input, 201, &doc)
				if doc.OwnCompanySnapshot == nil || doc.OwnCompanySnapshot.Role != "buyer" || doc.OwnCompanySnapshot.SourceVersion != profile.Version ||
					(doc.PartnerSnapshot != nil) != selected || doc.SourceID == nil || *doc.SourceID != item.ID {
					t.Fatal("review conversion capture/manual/original boundary lost")
				}
				persisted, err := s.Store.Get(ctx, doc.ID)
				if err != nil {
					t.Fatal(err)
				}
				before, _ := json.Marshal(persisted)
				data.Name = "changed profile"
				snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": profile.Version, "data": data}, 200, &profile)
				snapshotCall(t, s, "POST", "imports/"+item.ID.Hex()+"/draft", input, 200, &doc)
				persisted, err = s.Store.Get(ctx, doc.ID)
				if err != nil {
					t.Fatal(err)
				}
				after, _ := json.Marshal(persisted)
				if string(after) != string(before) {
					t.Fatal("review retry recaptured history")
				}
			}
		})
	}
}

func TestSnapshotCanonicalAndLegacyScope(t *testing.T) {
	for _, persistent := range []bool{false, true} {
		t.Run(fmt.Sprint(persistent), func(t *testing.T) {
			s := snapshotServer(t, persistent)
			ctx := context.Background()
			other := primitive.NewObjectID()
			for _, axes := range [][2]primitive.ObjectID{{{}, {}}, {s.Company, {}}, {{}, s.Company}, {other, {}}, {{}, other}} {
				c, _ := newContact(sampleContact(), s.Company)
				c.OrganisationID, c.ProjectID, c.OwnerID = axes[0], axes[1], s.Company
				if persistent {
					store := s.Store.(*MongoStore)
					raw, _ := bson.Marshal(c)
					var record bson.M
					bson.Unmarshal(raw, &record)
					if axes[0].IsZero() {
						delete(record, "organisationId")
					}
					if axes[1].IsZero() {
						record["projectId"] = nil
					}
					if _, err := store.Client.InsertOne(ctx, store.Name, "contacts", record); err != nil {
						t.Fatal(err)
					}
				} else {
					s.Contacts.(*MemoryContacts).items[c.ID] = c
				}
				body := draftRequest{Draft: draft("invoice"), PartnerAction: "select", ContactID: c.ID.Hex(), ExpectedContactVersion: 1}
				expected := 201
				if axes[0] == other || axes[1] == other {
					expected = 404
				}
				before, _ := s.Store.List(ctx)
				snapshotCall(t, s, "POST", "documents", body, expected, nil)
				after, _ := s.Store.List(ctx)
				if expected == 404 && len(before) != len(after) {
					t.Fatal("foreign selection created document")
				}
			}
		})
	}
}

type editAfterReadContacts struct {
	ContactStore
	once bool
}

func (s *editAfterReadContacts) Get(ctx context.Context, id primitive.ObjectID) (Contact, error) {
	c, err := s.ContactStore.Get(ctx, id)
	if err == nil && !s.once {
		s.once = true
		changed := cloneContact(c)
		changed.Name, changed.BankAccount, changed.Tags = "after-read", "new bank", []string{"after-read"}
		if err := s.ContactStore.Save(ctx, changed, c.Version); err != nil {
			return Contact{}, err
		}
	}
	return c, err
}
func TestSnapshotReadVersionNotCrossDocumentLock(t *testing.T) {
	for _, persistent := range []bool{false, true} {
		t.Run(fmt.Sprint(persistent), func(t *testing.T) {
			s := snapshotServer(t, persistent)
			c, _ := newContact(sampleContact(), s.Company)
			if err := s.Contacts.Create(context.Background(), c); err != nil {
				t.Fatal(err)
			}
			s.Contacts = &editAfterReadContacts{ContactStore: s.Contacts}
			var doc Document
			snapshotCall(t, s, "POST", "documents", draftRequest{Draft: draft("invoice"), PartnerAction: "select", ContactID: c.ID.Hex(), ExpectedContactVersion: 1}, 201, &doc)
			if doc.PartnerSnapshot.SourceVersion != 1 || !reflect.DeepEqual(doc.PartnerSnapshot.Data, c.ContactData) {
				t.Fatal("mixed contact versions")
			}
			current, _ := s.Contacts.Get(context.Background(), c.ID)
			if current.Version != 2 || current.Name != "after-read" {
				t.Fatal("did not simulate intervening edit")
			}
		})
	}
}

func TestCompanyProfileLegacyScopeAndConflicts(t *testing.T) {
	for _, persistent := range []bool{false, true} {
		t.Run(fmt.Sprint(persistent), func(t *testing.T) {
			for _, variant := range []string{"missing", "null", "zero", "organisation-only", "project-only", "foreign-organisation", "foreign-project"} {
				t.Run(variant, func(t *testing.T) {
					s := snapshotServer(t, persistent)
					ctx := context.Background()
					p := CompanyProfile{ID: s.Company, OwnerID: s.Company, Version: 1, Data: sampleContact()}
					switch variant {
					case "organisation-only":
						p.OrganisationID = s.Company
					case "project-only":
						p.ProjectID = s.Company
					case "foreign-organisation":
						p.OrganisationID = primitive.NewObjectID()
					case "foreign-project":
						p.ProjectID = primitive.NewObjectID()
					}

					if persistent {
						raw, _ := bson.Marshal(p)
						var record bson.M
						bson.Unmarshal(raw, &record)
						for _, axis := range []string{"organisationId", "projectId"} {
							if variant == "missing" {
								delete(record, axis)
							}
							if variant == "null" {
								record[axis] = nil
							}
						}
						store := s.Store.(*MongoStore)
						if _, err := store.Client.InsertOne(ctx, store.Name, "company_profiles", record); err != nil {
							t.Fatal(err)
						}
					} else {
						s.Profiles.(*MemoryCompany).profile = &p
					}
					foreign := strings.HasPrefix(variant, "foreign")
					var got *CompanyProfile
					snapshotCall(t, s, "GET", "company-profile", nil, 200, &got)
					if foreign {
						if got != nil {
							t.Fatal("foreign canonical axis lost precedence")
						}
						snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": 0, "data": sampleContact()}, 409, nil)
					} else {
						if got == nil || got.Version != 1 || got.Data.Name != p.Data.Name {
							t.Fatal("legacy profile not visible")
						}
						snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": 1, "data": sampleContact()}, 200, &got)
						before, _ := s.Profiles.Get(ctx)
						snapshotCall(t, s, "PUT", "company-profile", map[string]any{"version": 1, "data": sampleContact()}, 409, nil)
						after, _ := s.Profiles.Get(ctx)
						if !reflect.DeepEqual(before, after) {
							t.Fatal("stale profile changed stored data")
						}
					}
				})
			}
		})
	}
}
