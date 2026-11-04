package accounting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/uug-ai/database/pkg/database"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func exerciseFinancialAudit(t *testing.T, store Store, company primitive.ObjectID) {
	t.Helper()
	ctx := context.Background()
	doc, _ := NewDocument(draft("invoice"), company)
	doc.Partner, doc.Email, doc.Reference = "Private contact", "private@example.invalid", "raw-body-secret"
	if err := store.Create(ctx, doc); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: store, Company: company, Dev: true, Origin: "http://127.0.0.1:19005",
		Authorization: testPolicy(t, "enforced", "development:local", company, []Capability{Read, Write, Post, Admin})}
	handler := s.Handler()
	path := "/api/documents/" + doc.ID.Hex()
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for range 2 {
		wg.Go(func() {
			codes <- apiRequest(handler, "POST", path+"/post", `{"version":1}`, "", s.Origin).Code
		})
	}
	wg.Wait()
	close(codes)
	success, conflict := 0, 0
	for code := range codes {
		switch code {
		case 200:
			success++
		case 409:
			conflict++
		default:
			t.Fatalf("unexpected post race response %d", code)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("post race successes=%d conflicts=%d", success, conflict)
	}
	loaded, err := store.Get(ctx, doc.ID)
	if err != nil || loaded.Version != 2 || loaded.Status != "posted" || len(loaded.FinancialEvents) != 1 {
		t.Fatalf("post and event atomicity: %+v %v", loaded, err)
	}
	first := loaded.FinancialEvents[0]
	if first.Action != "document.post" || first.Version != 2 || first.TargetID != doc.ID ||
		first.Principal != "development:local" || first.ActorType != "development" || first.Outcome != "committed" ||
		first.ID.IsZero() || first.Time.IsZero() || first.Time.Location() != time.UTC {
		t.Fatalf("invalid post attribution %+v", first)
	}
	codes = make(chan int, 2)
	for range 2 {
		wg.Go(func() {
			body := fmt.Sprintf(`{"version":2,"id":"same-key","amount":1,"date":%q}`, doc.Date)
			codes <- apiRequest(handler, "POST", path+"/payments", body, "", s.Origin).Code
		})
	}
	wg.Wait()
	close(codes)
	success, conflict = 0, 0
	for code := range codes {
		if code == 200 {
			success++
		} else if code == 409 {
			conflict++
		} else {
			t.Fatalf("unexpected payment race %d", code)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatal("duplicate key raced successfully twice")
	}
	loaded, _ = store.Get(ctx, doc.ID)
	if loaded.Paid != 1 || len(loaded.Payments) != 1 || len(loaded.FinancialEvents) != 2 {
		t.Fatal("payment and event not atomic", loaded)
	}
	duplicate := fmt.Sprintf(`{"version":3,"id":"same-key","amount":1,"date":%q}`, doc.Date)
	if w := apiRequest(handler, "POST", path+"/payments", duplicate, "", s.Origin); w.Code != 422 {
		t.Fatal("duplicate key accepted at fresh version", w.Code, w.Body)
	}
	if w := apiRequest(handler, "POST", path+"/post", `{"version":3}`, "", s.Origin); w.Code != 422 {
		t.Fatal("second posting accepted")
	}
	// All 200 payments are real successful HTTP mutations, not pre-seeded history.
	for payment := 2; payment <= 200; payment++ {
		body := fmt.Sprintf(`{"version":%d,"id":"payment-%d","amount":1,"date":%q}`, payment+1, payment, doc.Date)
		if w := apiRequest(handler, "POST", path+"/payments", body, "", s.Origin); w.Code != 200 {
			t.Fatalf("payment %d: %d %s", payment, w.Code, w.Body)
		} else if strings.Contains(w.Body.String(), "financialEvents") || strings.Contains(w.Body.String(), "principal") {
			t.Fatal("ordinary mutation exposed events")
		}
	}
	last, _ := store.Get(ctx, doc.ID)
	if len(last.FinancialEvents) != 201 || len(last.Payments) != 200 || last.FinancialEvents[0] != first || last.Version != 202 {
		t.Fatalf("history not preserved or bounded: events=%d payments=%d version=%d", len(last.FinancialEvents), len(last.Payments), last.Version)
	}
	ids := map[primitive.ObjectID]bool{}
	for i, event := range last.FinancialEvents {
		if ids[event.ID] || event.Version != int64(i+2) || event.TargetID != doc.ID {
			t.Fatal("duplicate/unordered attribution")
		}
		ids[event.ID] = true
	}
	body := fmt.Sprintf(`{"version":202,"id":"over-limit","amount":1,"date":%q}`, doc.Date)
	if w := apiRequest(handler, "POST", path+"/payments", body, "", s.Origin); w.Code != 422 {
		t.Fatal("201st payment accepted", w.Code, w.Body)
	}
	after, _ := store.Get(ctx, doc.ID)
	if after.Version != last.Version || len(after.FinancialEvents) != 201 {
		t.Fatal("rejected action changed history")
	}
	w := apiRequest(handler, "GET", "/api/state", "", "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "financialEvents") || strings.Contains(w.Body.String(), "principal") {
		t.Fatal("ordinary state exposed audit")
	}
	w = apiRequest(handler, "GET", path+"/audit", "", "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "Private contact") || strings.Contains(w.Body.String(), "private@") ||
		strings.Contains(w.Body.String(), "raw-body-secret") || strings.Contains(w.Body.String(), "csrf") || strings.Contains(w.Body.String(), "sha256") {
		t.Fatal("audit response exposes non-attribution data", w.Code, w.Body)
	}
	if mongo, ok := store.(*MongoStore); ok {
		if _, err := mongo.Client.UpdateOne(ctx, mongo.Name, "accounting_documents", bson.M{"_id": doc.ID}, bson.M{"$set": bson.M{
			"financialEvents.0.token": "synthetic-private-token", "financialEvents.0.csrf": "synthetic-private-csrf",
			"financialEvents.0.rawBody": "synthetic-private-body", "financialEvents.0.contact": "synthetic-private-contact",
			"financialEvents.0.sha256": "synthetic-private-hash",
		}}); err != nil {
			t.Fatal(err)
		}
		w = apiRequest(handler, "GET", path+"/audit", "", "", "")
		if w.Code != 200 || strings.Contains(w.Body.String(), "synthetic-private") {
			t.Fatal("raw storage extras escaped audit allowlist", w.Code, w.Body)
		}
	}
	var response struct {
		Events []FinancialEvent `json:"events"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || len(response.Events) != 201 {
		t.Fatal("audit retrieval missing events", err)
	}
	s.Authorization = testPolicy(t, "enforced", "development:local", company, []Capability{Read, Admin})
	if w := apiRequest(handler, "POST", path+"/payments", body, "", s.Origin); w.Code != 403 {
		t.Fatal("admin implied financial rights")
	}
	s.Authorization = testPolicy(t, "enforced", "development:local", company, []Capability{Read, Post})
	if w := apiRequest(handler, "GET", path+"/audit", "", "", ""); w.Code != 403 {
		t.Fatal("poster implied audit rights")
	}
	s.Authorization = testPolicy(t, "enforced", "development:local", company, []Capability{Read, Post, Admin})
	legacy, _ := NewDocument(draft("bill"), company)
	legacy.Post()
	legacy.OrganisationID, legacy.ProjectID, legacy.OwnerID = primitive.NilObjectID, primitive.NilObjectID, company
	// Import a historical posted document without claiming a historical actor.
	if mongo, ok := store.(*MongoStore); ok {
		if _, err := mongo.Client.InsertOne(ctx, mongo.Name, "accounting_documents", legacy); err != nil {
			t.Fatal(err)
		}
	} else if err := store.Create(ctx, legacy); err != nil {
		t.Fatal(err)
	}
	legacyPath := "/api/documents/" + legacy.ID.Hex()
	if w := apiRequest(handler, "GET", legacyPath+"/audit", "", "", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"events":[]`) {
		t.Fatal("legacy history fabricated", w.Code, w.Body)
	}
	body = fmt.Sprintf(`{"version":1,"id":"legacy-new","amount":1,"date":%q}`, legacy.Date)
	if w := apiRequest(handler, "POST", legacyPath+"/payments", body, "", s.Origin); w.Code != 200 {
		t.Fatal("legacy new payment failed", w.Code, w.Body)
	}
	legacy, _ = store.Get(ctx, legacy.ID)
	if len(legacy.FinancialEvents) != 1 || legacy.FinancialEvents[0].Action != "manual-payment.record" ||
		legacy.OrganisationID != company || legacy.ProjectID != company {
		t.Fatal("legacy event/ownership wrong", legacy)
	}
	// Ordinary Save cannot replace or truncate existing financial history.
	legacy.FinancialEvents = nil
	if err := store.Save(ctx, legacy, legacy.Version); err != nil {
		t.Fatal(err)
	}
	legacy, _ = store.Get(ctx, legacy.ID)
	if len(legacy.FinancialEvents) != 1 {
		t.Fatal("ordinary save erased history")
	}
	copy := clone(legacy)
	copy.FinancialEvents[0].Principal = "github:999"
	current, _ := store.Get(ctx, legacy.ID)
	if current.FinancialEvents[0].Principal != "development:local" {
		t.Fatal("memory clone aliases event history")
	}
}

func TestMemoryFinancialAuditAtomicity(t *testing.T) {
	exerciseFinancialAudit(t, NewMemoryStore(), testCompany)
}

func TestMemoryAuditScopeAndIntegrity(t *testing.T) {
	s, request := authorizationServer(t, "development")
	s.Authorization = testPolicy(t, "enforced", "development:local", testCompany, []Capability{Read, Write, Post, Admin})
	legacy, _ := NewDocument(draft("invoice"), testCompany)
	legacy.OrganisationID, legacy.ProjectID, legacy.OwnerID = primitive.NilObjectID, primitive.NilObjectID, testCompany
	if err := s.Store.Create(context.Background(), legacy); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.Store.Get(context.Background(), legacy.ID)
	if err != nil || loaded.OrganisationID != testCompany || loaded.ProjectID != testCompany {
		t.Fatal("memory legacy reader requires backfill", err)
	}
	listed, err := s.Store.List(context.Background())
	if err != nil || len(listed) != 1 || listed[0].OrganisationID != testCompany || listed[0].ProjectID != testCompany {
		t.Fatal("memory legacy list requires backfill", err)
	}
	stored := s.Store.(*MemoryStore).docs[legacy.ID]
	if !stored.OrganisationID.IsZero() || !stored.ProjectID.IsZero() {
		t.Fatal("legacy reader performed a migration")
	}
	for _, axis := range []string{"organisation", "project", "owner"} {
		doc, _ := NewDocument(draft("invoice"), testCompany)
		doc.OwnerID = testCompany
		switch axis {
		case "organisation":
			doc.OrganisationID = primitive.NewObjectID()
		case "project":
			doc.ProjectID = primitive.NewObjectID()
		case "owner":
			doc.OrganisationID, doc.ProjectID, doc.OwnerID = primitive.NilObjectID, primitive.NilObjectID, primitive.NewObjectID()
		}
		if err := s.Store.Create(context.Background(), doc); err != nil {
			t.Fatal(err)
		}
		path := "/api/documents/" + doc.ID.Hex()
		for _, route := range []struct{ method, suffix, body string }{
			{"GET", "/audit", ""},
			{"POST", "/post", `{"version":1}`},
			{"POST", "/payments", `{"version":1}`},
			{"PUT", "", `{"version":1}`},
		} {
			if w := request(route.method, path+route.suffix, route.body, true, true); w.Code != 404 {
				t.Fatal("foreign canonical/legacy axis leaked in memory", axis, w.Code, w.Body)
			}
		}
		if w := request("GET", "/api/state", "", true, true); w.Code != 200 || strings.Contains(w.Body.String(), doc.ID.Hex()) {
			t.Fatal("foreign memory state leaked")
		}
	}
	doc, _ := NewDocument(draft("invoice"), testCompany)
	doc.FinancialEvents = []FinancialEvent{{Principal: "synthetic-private-invalid-principal"}}
	if err := s.Store.Create(context.Background(), doc); err != nil {
		t.Fatal(err)
	}
	w := request("GET", "/api/documents/"+doc.ID.Hex()+"/audit", "", true, true)
	if w.Code != 503 || strings.Contains(w.Body.String(), "synthetic-private") || strings.Contains(w.Body.String(), `"events"`) {
		t.Fatal("invalid history was silently trimmed or disclosed", w.Code, w.Body)
	}
}

func TestFinancialAttributionAllModesAndSpoofRejection(t *testing.T) {
	for _, mode := range []string{"github", "token", "development"} {
		t.Run(mode, func(t *testing.T) {
			s, request := authorizationServer(t, mode)
			doc, _ := NewDocument(draft("invoice"), testCompany)
			if err := s.Store.Create(context.Background(), doc); err != nil {
				t.Fatal(err)
			}
			path := "/api/documents/" + doc.ID.Hex()
			for _, payload := range []string{
				`{"version":1,"actor":"github:99"}`,
				`{"version":1,"principal":"github:99"}`,
				`{"version":1,"financialEvents":[]}`,
				`{"version":1,"organisationId":"000000000000000000000099"}`,
			} {
				if w := request("POST", path+"/post", payload, true, true); w.Code != 400 {
					t.Fatal("client supplied attribution/ownership", w.Code, w.Body)
				}
			}
			if w := request("POST", path+"/post", `{"version":1}`, true, true); w.Code != 200 {
				t.Fatal("valid posting failed", w.Code, w.Body)
			}
			body := fmt.Sprintf(`{"version":2,"id":"new-payment","amount":1,"date":%q}`, doc.Date)
			if w := request("POST", path+"/payments", body, true, true); w.Code != 200 {
				t.Fatal("valid payment failed", w.Code, w.Body)
			}
			loaded, _ := s.Store.Get(context.Background(), doc.ID)
			principal := map[string]string{"github": "github:42", "token": "token:company", "development": "development:local"}[mode]
			if loaded.OrganisationID != testCompany || loaded.ProjectID != testCompany || len(loaded.FinancialEvents) != 2 {
				t.Fatal("identity reinterpreted as ownership or events missing")
			}
			for _, event := range loaded.FinancialEvents {
				if event.Principal != principal || event.ActorType != mode {
					t.Fatalf("incorrect server attribution %+v", event)
				}
			}
		})
	}
}

func TestMongoFinancialAuditAtomicity(t *testing.T) {
	uri := os.Getenv("ODEE_TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("requires disposable standalone MongoDB via web/tests/capabilities.mjs or test:mongo")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	store, err := OpenMongo(ctx, uri, "odee_test_audit_"+primitive.NewObjectID().Hex(), testCompany)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Client.Disconnect(context.Background())
	var hello bson.M
	native := store.Client.(*database.MongoClient)
	if err := native.Client.Database("admin").RunCommand(ctx, bson.D{{Key: "hello", Value: 1}}).Decode(&hello); err != nil || hello["setName"] != nil {
		t.Fatal("this proof must run on standalone MongoDB", err, hello["setName"])
	}
	exerciseFinancialAudit(t, store, testCompany)
	for _, action := range []string{"post", "payments"} {
		t.Run("uncertain-"+action+"-committed", func(t *testing.T) { exerciseUncertainWrite(t, store, true, action) })
		t.Run("uncertain-"+action+"-not-committed", func(t *testing.T) { exerciseUncertainWrite(t, store, false, action) })
	}
}

type uncertainDatabase struct {
	database.DatabaseInterface
	commit bool
}

func (d uncertainDatabase) UpdateOne(ctx context.Context, name, collection string, filter, update any, opts ...any) (database.UpdateResultInterface, error) {
	if d.commit {
		if _, err := d.DatabaseInterface.UpdateOne(ctx, name, collection, filter, update, opts...); err != nil {
			return nil, err
		}
	}
	return nil, errors.New("synthetic transport lost the acknowledgement")
}

func exerciseUncertainWrite(t *testing.T, store *MongoStore, commit bool, action string) {
	t.Helper()
	ctx := context.Background()
	doc, _ := NewDocument(draft("invoice"), testCompany)
	if action == "payments" {
		if err := doc.Post(); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Create(ctx, doc); err != nil {
		t.Fatal(err)
	}
	original := store.Client
	store.Client = uncertainDatabase{original, commit}
	defer func() { store.Client = original }()
	s := &Server{Store: store, Company: testCompany, Dev: true, Origin: "http://127.0.0.1:19005"}
	handler := s.Handler()
	path := "/api/documents/" + doc.ID.Hex() + "/" + action
	body := `{"version":1}`
	if action == "payments" {
		body = fmt.Sprintf(`{"version":1,"id":"uncertain-payment","amount":1,"date":%q}`, doc.Date)
	}
	w := apiRequest(handler, "POST", path, body, "", s.Origin)
	if w.Code != 503 || !strings.Contains(w.Body.String(), "reconciliation_required") || strings.Contains(w.Body.String(), "transport") {
		t.Fatal("uncertain outcome invented success/failure or exposed internal error", w.Code, w.Body)
	}
	reconciled, err := store.Get(ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if commit {
		if reconciled.Version != 2 || len(reconciled.FinancialEvents) != 1 || reconciled.Status != "posted" {
			t.Fatal("uncertain actual commit lost paired mutation/event")
		}
		if action == "payments" && (reconciled.Paid != 1 || len(reconciled.Payments) != 1 || reconciled.FinancialEvents[0].Action != "manual-payment.record") {
			t.Fatal("uncertain payment lost paired mutation/event")
		}
		store.Client = original
		if w := apiRequest(handler, "POST", path, body, "", s.Origin); w.Code != 409 {
			t.Fatal("uncertain stale retry duplicated mutation")
		}
	} else if reconciled.Version != 1 || len(reconciled.FinancialEvents) != 0 || reconciled.Status != doc.Status || reconciled.Paid != 0 {
		t.Fatal("uncertain uncommitted write manufactured event")
	}
}
