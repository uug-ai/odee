package accounting

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestMongoAuthorizationCanonicalAndLegacyEverySurface(t *testing.T) {
	uri := os.Getenv("ODEE_TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("requires disposable standalone MongoDB")
	}
	ctx := context.Background()
	foreign := primitive.NewObjectID()
	cases := []struct {
		name                         string
		organisation, project, owner primitive.ObjectID
		visible                      bool
	}{
		{"canonical-over-foreign-owner", testCompany, testCompany, foreign, true},
		{"legacy-both-missing", primitive.NilObjectID, primitive.NilObjectID, testCompany, true},
		{"legacy-organisation-missing", primitive.NilObjectID, testCompany, testCompany, true},
		{"legacy-project-missing", testCompany, primitive.NilObjectID, testCompany, true},
		{"foreign-organisation-precedes-owner", foreign, testCompany, testCompany, false},
		{"foreign-project-precedes-owner", testCompany, foreign, testCompany, false},
		{"foreign-legacy-owner", primitive.NilObjectID, primitive.NilObjectID, foreign, false},
	}
	for _, mode := range []string{"github", "token", "development"} {
		for _, scope := range cases {
			t.Run(mode+"/"+scope.name, func(t *testing.T) {
				store, err := OpenMongo(ctx, uri, "odee_test_scope_"+primitive.NewObjectID().Hex(), testCompany)
				if err != nil {
					t.Fatal(err)
				}
				defer store.Client.Disconnect(ctx)
				contacts, err := NewMongoContacts(ctx, store)
				if err != nil {
					t.Fatal(err)
				}
				imports, err := NewMongoImports(ctx, store)
				if err != nil {
					t.Fatal(err)
				}
				rewrite := func(value any) bson.M {
					t.Helper()
					data, err := bson.Marshal(value)
					if err != nil {
						t.Fatal(err)
					}
					var raw bson.M
					if err := bson.Unmarshal(data, &raw); err != nil {
						t.Fatal(err)
					}
					for axis, id := range map[string]primitive.ObjectID{
						"organisationId": scope.organisation, "projectId": scope.project, "ownerId": scope.owner,
					} {
						if id.IsZero() {
							delete(raw, axis)
						} else {
							raw[axis] = id
						}
					}
					return raw
				}
				docs := make([]Document, 3)
				for i := range docs {
					docs[i], _ = NewDocument(draft("invoice"), testCompany)
					if i == 2 {
						docs[i].Post()
					}
					if _, err := store.Client.InsertOne(ctx, store.Name, "accounting_documents", rewrite(docs[i])); err != nil {
						t.Fatal(err)
					}
				}
				contact, _ := newContact(sampleContact(), testCompany)
				if _, err := store.Client.InsertOne(ctx, store.Name, "contacts", rewrite(contact)); err != nil {
					t.Fatal(err)
				}
				data := samplePDF(sampleText)
				item := importMetadata(testCompany, data)
				item.Status, item.Scan = "ready", extract(sampleText)
				if err := imports.Upload(ctx, item, data); err != nil {
					t.Fatal(err)
				}
				metadata := rewrite(item)
				delete(metadata, "id")
				if _, err := store.Client.UpdateOne(ctx, store.Name, "bill_imports.files", bson.M{"_id": item.ID},
					bson.M{"$set": bson.M{"metadata": metadata}}); err != nil {
					t.Fatal(err)
				}
				s, request := authorizationServer(t, mode)
				s.Store, s.Contacts, s.Imports, s.Scanner = store, contacts, imports, NewScanner("eng")
				principal := map[string]string{"github": "github:42", "token": "token:company", "development": "development:local"}[mode]
				s.Authorization = testPolicy(t, "enforced", principal, testCompany, []Capability{Read, Write, Post, Admin})
				state := request("GET", "/api/state", "", true, true)
				if state.Code != 200 || strings.Contains(state.Body.String(), docs[0].ID.Hex()) != scope.visible ||
					strings.Contains(state.Body.String(), item.ID.Hex()) != scope.visible ||
					strings.Contains(state.Body.String(), contact.ID.Hex()) != scope.visible {
					t.Fatalf("state scope mismatch: %d %s", state.Code, state.Body)
				}
				list := request("GET", "/api/contacts", "", true, true)
				if list.Code != 200 || strings.Contains(list.Body.String(), contact.ID.Hex()) != scope.visible {
					t.Fatal("contact list scope mismatch", list.Code, list.Body)
				}
				edit, _ := json.Marshal(struct {
					Draft
					Version int64 `json:"version"`
				}{draft("invoice"), 1})
				contactEdit, _ := json.Marshal(struct {
					ContactData
					Version int64 `json:"version"`
				}{sampleContact(), 1})
				review, _ := json.Marshal(struct {
					Draft
					Reviewed bool `json:"reviewed"`
				}{item.Scan.Draft, true})
				for _, route := range []struct {
					method, path, body string
					success            int
				}{
					{"GET", "/api/documents/" + docs[0].ID.Hex() + "/audit", "", 200},
					{"PUT", "/api/documents/" + docs[0].ID.Hex(), string(edit), 200},
					{"POST", "/api/documents/" + docs[1].ID.Hex() + "/post", `{"version":1}`, 200},
					{"POST", "/api/documents/" + docs[2].ID.Hex() + "/payments", fmt.Sprintf(`{"version":1,"id":"new","date":%q,"amount":1}`, docs[2].Date), 200},
					{"PUT", "/api/contacts/" + contact.ID.Hex(), string(contactEdit), 200},
					{"GET", "/api/imports/" + item.ID.Hex(), "", 200},
					{"GET", "/api/imports/" + item.ID.Hex() + "/original", "", 200},
					{"GET", "/api/imports/" + item.ID.Hex() + "/preview", "", 200},
					{"POST", "/api/imports/" + item.ID.Hex() + "/scan", `{}`, 200},
					{"POST", "/api/imports/" + item.ID.Hex() + "/draft", string(review), 201},
				} {
					t.Run(route.method+route.path, func(t *testing.T) {
						want := 404
						if scope.visible {
							want = route.success
						}
						w := request(route.method, route.path, route.body, true, true)
						if w.Code != want {
							t.Fatalf("scope expected %d, got %d: %s", want, w.Code, w.Body)
						}
					})
				}
				// Creation must use configured BSON ownership, never a client actor/tenant.
				for _, path := range []string{"/api/documents", "/api/contacts", "/api/contacts/import", "/api/imports/" + item.ID.Hex() + "/draft"} {
					w := request("POST", path, `{"organisationId":"000000000000000000000099","actor":"github:99"}`, true, true)
					if w.Code != 400 {
						t.Fatal("client ownership/actor accepted", path, w.Code, w.Body)
					}
				}
			})
		}
	}
}
