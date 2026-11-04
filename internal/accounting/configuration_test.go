package accounting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/uug-ai/database/pkg/database"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/event"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func configTestStore(t *testing.T, persistent bool) Store {
	t.Helper()
	if !persistent {
		return NewMemoryStore()
	}
	uri := os.Getenv("ODEE_TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("requires disposable standalone MongoDB through normal test:mongo")
	}
	s, err := OpenMongo(context.Background(), uri, "odee_test_config_"+primitive.NewObjectID().Hex(), testCompany)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Client.Disconnect(context.Background()); err != nil {
			t.Error(err)
		}
	})
	return s
}
func stageAndPublish(t *testing.T, store Store, data ConfigurationData, version int64) PublishedConfiguration {
	t.Helper()
	return stageAndPublishForCompany(t, store, data, version, testCompany)
}
func stageAndPublishForCompany(t *testing.T, store Store, data ConfigurationData, version int64, company primitive.ObjectID) PublishedConfiguration {
	t.Helper()
	ctx := context.Background()
	if err := data.normalize(); err != nil {
		t.Fatal(err)
	}
	stage := ConfigurationStage{version + 1, primitive.NewObjectID(), data, configurationDigest(data), time.Now().UTC()}
	if err := store.Configuration(company).SaveStage(ctx, stage, version); err != nil {
		t.Fatal(err)
	}
	p, err := publishConfiguration(ctx, store.Configuration(company), company, stage.Version, stage.PublicationID)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func syntheticV2() ConfigurationData {
	data := starterConfiguration()
	for i, a := range data.Accounts {
		if a.Code == "1000" {
			data.Accounts[i].Code = "1010"
			data.Accounts[i].Name = "Synthetic V2 bank"
		}
		if a.Code == "1100" {
			data.Accounts[i].Code = "1110"
			data.Accounts[i].Name = "Synthetic V2 receivable"
		}
		if a.Code == "4000" {
			data.Accounts[i].Name = "Synthetic V2 revenue meaning"
		}
	}
	data.Accounts = append(data.Accounts, ConfigAccount{"1100", "Different V2 expense meaning", "expense", true})
	data.Mappings["bank"] = "1010"
	data.Mappings["receivable"] = "1110"
	return data
}
func configHTTP(t *testing.T, store Store) (*Server, func(string, string, any, int) *httptest.ResponseRecorder) {
	t.Helper()
	s := &Server{Store: store, Company: testCompany, Dev: true, Origin: "http://127.0.0.1:19008"}
	s.Authorization = testPolicy(t, "enforced", "development:local", testCompany, []Capability{Read, Write, Post, Admin})
	handler := s.Handler()
	call := func(method, path string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		raw := ""
		if body != nil {
			data, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			raw = string(data)
		}
		r := apiRequest(handler, method, path, raw, "", s.Origin)
		if r.Code != status {
			t.Fatalf("%s %s: got %d want %d %s", method, path, r.Code, status, r.Body)
		}
		return r
	}
	return s, call
}
func exerciseConfiguration(t *testing.T, store Store) {
	ctx := context.Background()
	cfg := store.Configuration(testCompany)
	v1 := stageAndPublish(t, store, starterConfiguration(), 0)
	if err := cfg.Activate(ctx, v1, 0); err != nil {
		t.Fatal(err)
	}
	_, call := configHTTP(t, store)
	docs := []Document{}
	for _, kind := range []string{"invoice", "bill"} {
		response := call("POST", "/api/documents", draft(kind), 201)
		var doc Document
		if err := json.Unmarshal(response.Body.Bytes(), &doc); err != nil {
			t.Fatal(err)
		}
		if doc.ConfigurationSelection == nil || *doc.ConfigurationSelection.VersionID != v1.ID {
			t.Fatal("server did not bind observed V1")
		}
		docs = append(docs, doc)
	}
	v2 := stageAndPublish(t, store, syntheticV2(), 1)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	wg.Go(func() { results <- cfg.Activate(ctx, v2, 1) })
	wg.Go(func() {
		doc := docs[0]
		data, err := selectedConfiguration(ctx, store, doc)
		if err == nil {
			err = doc.Post(data)
		}
		if err == nil {
			err = doc.attribute(context.WithValue(ctx, principalKey{}, "development:local"), "document.post")
		}
		if err == nil {
			err = store.Save(ctx, doc, doc.Version)
		}
		results <- err
	})
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := cfg.Activate(ctx, v1, 1); !errors.Is(err, ErrConflict) {
		t.Fatal("stale activation accepted", err)
	}
	for index, doc := range docs {
		if index == 1 {
			call("POST", "/api/documents/"+doc.ID.Hex()+"/post", map[string]any{"version": doc.Version}, 200)
		}
		posted, err := store.Get(ctx, doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		var expected []Entry
		if doc.Kind == "invoice" {
			expected = []Entry{{"1100", 24200, 0}, {"4000", 0, 20000}, {"2100", 0, 4200}}
		} else {
			expected = []Entry{{"5000", 20000, 0}, {"2000", 0, 24200}, {"1200", 4200, 0}}
		}
		if !reflect.DeepEqual(posted.Entries, expected) || !Balanced(posted.Entries) || posted.FinancialSnapshot == nil || *posted.FinancialSnapshot.Selection.VersionID != v1.ID {
			t.Fatalf("mixed original posting: %+v", posted)
		}
		call("POST", "/api/documents/"+doc.ID.Hex()+"/payments", map[string]any{"version": posted.Version, "id": "original-payment", "date": doc.Date, "amount": 10000}, 200)
		paid, _ := store.Get(ctx, doc.ID)
		payment := []Entry{{"1000", 10000, 0}, {"1100", 0, 10000}}
		if doc.Kind == "bill" {
			payment = []Entry{{"2000", 10000, 0}, {"1000", 0, 10000}}
		}
		if !reflect.DeepEqual(paid.Payments[0].Entries, payment) || paid.Total-paid.Paid != 14200 || !reflect.DeepEqual(paid.Entries, expected) || len(paid.FinancialEvents) != 2 || !Balanced(payment) {
			t.Fatal("original payment meaning lost", paid)
		}
		before := clone(paid)
		call("POST", "/api/documents/"+doc.ID.Hex()+"/payments", map[string]any{"version": paid.Version, "id": "original-payment", "date": doc.Date, "amount": 1}, 422)
		after, _ := store.Get(ctx, doc.ID)
		if !reflect.DeepEqual(before, clone(after)) {
			t.Fatal("rejection changed financial state")
		}
	}
	newDraftResponse := call("POST", "/api/documents", draft("invoice"), 201)
	var rebound Document
	json.Unmarshal(newDraftResponse.Body.Bytes(), &rebound)
	if *rebound.ConfigurationSelection.VersionID != v2.ID {
		t.Fatal("new draft did not observe V2")
	}
	call("POST", "/api/documents/"+rebound.ID.Hex()+"/configuration", map[string]any{"version": rebound.Version, "targetVersionId": v1.ID}, 200)
	rebound, _ = store.Get(ctx, rebound.ID)
	if *rebound.ConfigurationSelection.VersionID != v1.ID || !reflect.DeepEqual(rebound.Lines, draft("invoice").Lines) {
		t.Fatal("explicit rebind substituted lines")
	}
	unready := starterConfiguration()
	unready.Mappings["bank"] = ""
	v3 := stageAndPublish(t, store, unready, 2)
	call("POST", "/api/accounting-configuration/activate", map[string]any{"expectedDefaultRevision": 2, "versionId": v3.ID}, 422)
	call("POST", "/api/documents/"+rebound.ID.Hex()+"/configuration", map[string]any{"version": rebound.Version, "targetVersionId": v3.ID}, 200)
	rebound, _ = store.Get(ctx, rebound.ID)
	before := clone(rebound)
	call("POST", "/api/documents/"+rebound.ID.Hex()+"/post", map[string]any{"version": rebound.Version}, 422)
	after, _ := store.Get(ctx, rebound.ID)
	if !reflect.DeepEqual(before, clone(after)) {
		t.Fatal("rejected post changed document")
	}
	duplicate, err := publishConfiguration(ctx, cfg, testCompany, v3.Payload.SourceStageVersion, v3.ID)
	if err != nil || !reflect.DeepEqual(duplicate.Payload, v3.Payload) {
		t.Fatal("publication retry changed business payload", err)
	}
	list := call("GET", "/api/accounting-configuration/versions", nil, 200)
	if strings.Contains(list.Body.String(), "durabilityNonce") {
		t.Fatal("private nonce leaked")
	}
	for _, policyCase := range []string{"legacy", "unknown"} {
		legacy, _ := NewDocument(draft("invoice"), testCompany)
		legacy.Post()
		legacy.ConfigurationSelection = nil
		legacy.FinancialSnapshot = nil
		if policyCase == "unknown" {
			legacy.Entries[0].AccountCode = "9876"
		}
		if err := store.Create(ctx, legacy); err != nil {
			t.Fatal(err)
		}
		want := 200
		if policyCase == "unknown" {
			want = 422
		}
		call("POST", "/api/documents/"+legacy.ID.Hex()+"/payments", map[string]any{"version": 1, "id": "legacy-pay", "date": legacy.Date, "amount": 10000}, want)
	}
	state := call("GET", "/api/state", nil, 200)
	if !strings.Contains(state.Body.String(), "9876") || !strings.Contains(state.Body.String(), "Financial meaning unknown") {
		t.Fatal("unknown history was dropped")
	}
	if err := cfg.Activate(ctx, v1, 2); err != nil {
		t.Fatal(err)
	}
	if err := cfg.Activate(ctx, v1, 1); !errors.Is(err, ErrConflict) {
		t.Fatal("ABA accepted old same-target revision", err)
	}
	if err := cfg.Activate(ctx, v2, 3); err != nil {
		t.Fatal(err)
	}
}
func TestConfigurationLifecycle(t *testing.T) { exerciseConfiguration(t, configTestStore(t, false)) }
func TestMongoConfigurationLifecycle(t *testing.T) {
	exerciseConfiguration(t, configTestStore(t, true))
}

func TestConfigurationValidationAndPermissions(t *testing.T) {
	store := NewMemoryStore()
	s, call := configHTTP(t, store)
	for _, caps := range [][]Capability{{Admin}, {Read}, {Write}, {Post}, {Read, Write}, {Read, Post}} {
		s.Authorization = testPolicy(t, "enforced", "development:local", testCompany, caps)
		handler := s.Handler()
		for _, route := range []struct{ method, path, body string }{{"PUT", "/api/accounting-configuration/stage", `{}`}, {"POST", "/api/accounting-configuration/versions", `{}`}, {"POST", "/api/accounting-configuration/activate", `{}`}} {
			r := apiRequest(handler, route.method, route.path, route.body, "", s.Origin)
			if r.Code != 403 {
				t.Fatalf("capabilities implied admin/read: %v %d", caps, r.Code)
			}
		}
	}
	s.Authorization = testPolicy(t, "enforced", "development:local", testCompany, []Capability{Read, Write, Post, Admin})
	data := starterConfiguration()
	data.Accounts[0].Type = "unsupported"
	call("PUT", "/api/accounting-configuration/stage", map[string]any{"expectedStageVersion": 0, "data": data}, 200)
	head, _ := store.Configuration(testCompany).Head(context.Background())
	call("POST", "/api/accounting-configuration/versions", map[string]any{"expectedStageVersion": 1, "publicationId": head.Stage.PublicationID}, 422)
	data = starterConfiguration()
	data.Years[0].Periods = append(data.Years[0].Periods, data.Years[0].Periods[0])
	call("PUT", "/api/accounting-configuration/stage", map[string]any{"expectedStageVersion": 1, "data": data}, 200)
	head, _ = store.Configuration(testCompany).Head(context.Background())
	call("POST", "/api/accounting-configuration/versions", map[string]any{"expectedStageVersion": 2, "publicationId": head.Stage.PublicationID}, 422)
	call("PUT", "/api/accounting-configuration/stage", map[string]any{"expectedStageVersion": 0, "data": data}, 409)
	zero := draft("invoice")
	zero.Lines[0].TaxBPS = 0
	doc, err := NewDocument(zero, testCompany)
	if err != nil {
		t.Fatal(err)
	}
	if err = doc.Post(); err != nil {
		t.Fatal(err)
	}
	if len(doc.Entries) != 2 || doc.Total != 20000 {
		t.Fatal("zero tax manufactured VAT entries")
	}
}
func TestConfigurationSelectedValidation(t *testing.T) {
	for _, name := range []string{"inactive-bank", "inactive-revenue", "missing-vat", "unsupported-journal", "outside-period", "line-mismatch", "zero-tax"} {
		t.Run(name, func(t *testing.T) {
			data := starterConfiguration()
			input := draft("invoice")
			switch name {
			case "inactive-bank":
				data.Accounts[0].Active = false
			case "inactive-revenue":
				for i, a := range data.Accounts {
					if a.Code == "4000" {
						data.Accounts[i].Active = false
					}
				}
			case "missing-vat":
				delete(data.Mappings, "vatPayable")
			case "unsupported-journal":
				data.Journals[0].Kind = "bill"
			case "outside-period":
				data.Years = []FiscalYear{{"2025-01-01", "2025-12-31", []FiscalPeriod{{"2025-01-01", "2025-12-31", true}}}}
			case "line-mismatch":
				data.Mappings["revenue"] = "4999"
				data.Accounts = append(data.Accounts, ConfigAccount{"4999", "Synthetic income", "income", true})
			case "zero-tax":
				input.Lines[0].TaxBPS = 0
			}
			data.normalize()
			id := primitive.NewObjectID()
			doc, err := NewDocument(input, testCompany, ConfigurationSelection{VersionID: &id, Digest: configurationDigest(data)})
			if err != nil {
				t.Fatal(err)
			}
			err = doc.Post(data)
			if name == "zero-tax" {
				if err != nil || len(doc.Entries) != 2 || doc.Tax != 0 {
					t.Fatal("zero tax manufactured VAT", err)
				}
			} else if err == nil || doc.Status != "draft" || len(doc.Entries) != 0 || doc.FinancialSnapshot != nil {
				t.Fatal("invalid selected config posted", err)
			}
		})
	}
}

type configurationPublishFault struct {
	database.DatabaseInterface
	commit bool
}

func (d configurationPublishFault) InsertOne(ctx context.Context, name, collection string, value any, opts ...any) (any, error) {
	if collection != "accounting_configuration_versions" {
		return d.DatabaseInterface.InsertOne(ctx, name, collection, value, opts...)
	}
	if d.commit {
		if _, err := d.DatabaseInterface.InsertOne(ctx, name, collection, value, opts...); err != nil {
			return nil, err
		}
	}
	return nil, errors.New("synthetic publication acknowledgement lost")
}
func TestMongoConfigurationPublicationUncertain(t *testing.T) {
	store := configTestStore(t, true).(*MongoStore)
	ctx := context.Background()
	cfg := store.Configuration(testCompany)
	original := store.Client
	for version, commit := range []bool{false, true} {
		data := starterConfiguration()
		data.normalize()
		stage := ConfigurationStage{int64(version + 1), primitive.NewObjectID(), data, configurationDigest(data), time.Now().UTC()}
		if err := cfg.SaveStage(ctx, stage, int64(version)); err != nil {
			t.Fatal(err)
		}
		store.Client = configurationPublishFault{original, commit}
		_, err := publishConfiguration(ctx, cfg, testCompany, stage.Version, stage.PublicationID)
		store.Client = original
		if !errors.Is(err, ErrUncertain) {
			t.Fatal("lost insert acknowledgement misreported", err)
		}
		head, _ := cfg.Head(ctx)
		if head.Default.Revision != 0 {
			t.Fatal("publication activated default")
		}
		p, err := cfg.Published(ctx, stage.PublicationID)
		if commit && err != nil {
			t.Fatal(err)
		}
		if !commit && !errors.Is(err, ErrNotFound) {
			t.Fatal("uncommitted insert appeared")
		}
		reconciled, err := publishConfiguration(ctx, cfg, testCompany, stage.Version, stage.PublicationID)
		if err != nil {
			t.Fatal(err)
		}
		if commit && !reflect.DeepEqual(reconciled.Payload, p.Payload) {
			t.Fatal("retry changed published business bytes")
		}
		if commit {
			stored, _ := cfg.Published(ctx, reconciled.ID)
			if stored.DurabilityNonce.IsZero() {
				t.Fatal("existing readable insert was not durably reasserted")
			}
		}
	}
}
func TestMongoConfigurationFinancialUncertain(t *testing.T) {
	store := configTestStore(t, true).(*MongoStore)
	ctx := context.Background()
	cfg := store.Configuration(testCompany)
	v1 := stageAndPublish(t, store, starterConfiguration(), 0)
	v2 := stageAndPublish(t, store, syntheticV2(), 1)
	if err := cfg.Activate(ctx, v2, 0); err != nil {
		t.Fatal(err)
	}
	_, call := configHTTP(t, store)
	for _, action := range []string{"post", "payments"} {
		for _, commit := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%t", action, commit), func(t *testing.T) {
				doc, _ := NewDocument(draft("invoice"), testCompany, ConfigurationSelection{VersionID: &v1.ID, Digest: v1.Payload.Digest})
				if err := store.Create(ctx, doc); err != nil {
					t.Fatal(err)
				}
				persisted, err := store.Get(ctx, doc.ID)
				if err != nil {
					t.Fatal(err)
				}
				doc = persisted
				if action == "payments" {
					call("POST", "/api/documents/"+doc.ID.Hex()+"/post", map[string]any{"version": doc.Version}, 200)
					doc, _ = store.Get(ctx, doc.ID)
				}
				before := clone(doc)
				body := map[string]any{"version": doc.Version}
				if action == "payments" {
					body["id"] = "uncertain-original"
					body["date"] = doc.Date
					body["amount"] = 10000
				}
				original := store.Client
				store.Client = uncertainDatabase{original, commit}
				call("POST", "/api/documents/"+doc.ID.Hex()+"/"+action, body, 503)
				store.Client = original
				after, err := store.Get(ctx, doc.ID)
				if err != nil {
					t.Fatal(err)
				}
				if !commit {
					if !reflect.DeepEqual(before, clone(after)) {
						t.Fatal("failed dispatch changed financial document")
					}
					return
				}
				if after.Version != before.Version+1 || len(after.FinancialEvents) != len(before.FinancialEvents)+1 || after.FinancialSnapshot == nil || *after.FinancialSnapshot.Selection.VersionID != v1.ID {
					t.Fatal("uncertain write lost whole V1 snapshot/event")
				}
				if action == "payments" && (!reflect.DeepEqual(after.Payments[0].Entries, []Entry{{"1000", 10000, 0}, {"1100", 0, 10000}}) || after.Total-after.Paid != 14200) {
					t.Fatal("uncertain payment used V2")
				}
				call("POST", "/api/documents/"+doc.ID.Hex()+"/"+action, body, 409)
			})
		}
	}
}

type configurationFaultDatabase struct {
	database.DatabaseInterface
	mode                     string
	commit                   bool
	nonceCalls, pointerCalls int
}

func (d *configurationFaultDatabase) UpdateOne(ctx context.Context, name, collection string, filter, update any, opts ...any) (database.UpdateResultInterface, error) {
	if collection == "accounting_configuration" {
		d.pointerCalls++
	}
	if collection == "accounting_configuration_versions" {
		d.nonceCalls++
		if d.mode == "noop" {
			return durableResult{&mongo.UpdateResult{MatchedCount: 1}}, nil
		}
		if d.mode == "missing" {
			return durableResult{&mongo.UpdateResult{}}, nil
		}
		if d.commit {
			if _, err := d.DatabaseInterface.UpdateOne(ctx, name, collection, filter, update, opts...); err != nil {
				return nil, err
			}
		}
		return nil, errors.New("synthetic target acknowledgement lost")
	}
	return d.DatabaseInterface.UpdateOne(ctx, name, collection, filter, update, opts...)
}
func TestMongoConfigurationDurableReassertion(t *testing.T) {
	store := configTestStore(t, true).(*MongoStore)
	ctx := context.Background()
	cfg := store.Configuration(testCompany)
	p := stageAndPublish(t, store, starterConfiguration(), 0)
	original := store.Client
	native, _ := nativeDatabase(original)
	var commands []bson.Raw
	var commandMu sync.Mutex
	// Observe commands on this isolated test client without profiler/admin privileges.
	monitored, err := mongo.Connect(ctx, options.Client().ApplyURI(os.Getenv("ODEE_TEST_MONGODB_URI")).SetMonitor(&event.CommandMonitor{Started: func(_ context.Context, e *event.CommandStartedEvent) {
		if e.CommandName == "update" && e.Command.Lookup("update").StringValue() == "accounting_configuration_versions" {
			commandMu.Lock()
			commands = append(commands, append(bson.Raw(nil), e.Command...))
			commandMu.Unlock()
		}
	}}))
	if err != nil {
		t.Fatal(err)
	}
	previousClient := native.Client
	native.Client = monitored
	defer func() { native.Client = previousClient; monitored.Disconnect(ctx) }()
	for _, mode := range []string{"lost-uncommitted", "lost-committed", "noop", "missing"} {
		t.Run(mode, func(t *testing.T) {
			fault := &configurationFaultDatabase{DatabaseInterface: original, mode: mode, commit: mode == "lost-committed"}
			store.Client = fault
			err := cfg.Activate(ctx, p, 0)
			store.Client = original
			if err == nil || fault.nonceCalls != 1 || fault.pointerCalls != 0 {
				t.Fatal("failed nonce allowed pointer", err, fault)
			}
			head, _ := cfg.Head(ctx)
			if head.Default.Revision != 0 {
				t.Fatal("pointer changed")
			}
			verified, err := cfg.Published(ctx, p.ID)
			if err != nil || !reflect.DeepEqual(verified.Payload, p.Payload) {
				t.Fatal("immutable payload changed", err)
			}
		})
	}
	if err := cfg.Activate(ctx, p, 0); err != nil {
		t.Fatal(err)
	}
	verified, _ := cfg.Published(ctx, p.ID)
	if verified.DurabilityNonce.IsZero() {
		t.Fatal("no real target update")
	}
	commandMu.Lock()
	defer commandMu.Unlock()
	if len(commands) != 2 {
		t.Fatal("expected actual committed-lost and successful target commands", len(commands))
	}
	for _, command := range commands {
		wc := command.Lookup("writeConcern").Document()
		if !wc.Lookup("j").Boolean() || wc.Lookup("w").StringValue() != "majority" || wc.Lookup("wtimeout").AsInt64() != 5000 {
			t.Fatal("target command lacked journaled bounded acknowledgement", command)
		}
		updates, _ := command.Lookup("updates").Array().Values()
		update := updates[0].Document()
		predicates, _ := update.Lookup("q", "$and").Array().Values()
		extra := predicates[1].Document()
		if update.Lookup("upsert").Boolean() || update.Lookup("u", "$set", "_durabilityNonce").ObjectID().IsZero() || extra.Lookup("payload.digest").StringValue() != p.Payload.Digest || extra.Lookup("_id").ObjectID() != p.ID || extra.Lookup("payload.sourceStageId").ObjectID() != testCompany || extra.Lookup("payload.sourceStageVersion").AsInt64() != p.Payload.SourceStageVersion || extra.Lookup("payload.publishedAt").DateTime() != p.Payload.PublishedAt.UnixMilli() {
			t.Fatal("target nonce command was not a real scoped identity update", update)
		}
	}
	encoded, _ := json.Marshal(verified)
	if strings.Contains(string(encoded), "Nonce") {
		t.Fatal("private nonce leaked")
	}
	if !reflect.DeepEqual(verified.Payload, p.Payload) {
		t.Fatal("reassertion mutated payload")
	}
}
func TestMongoConfigurationScope(t *testing.T) {
	store := configTestStore(t, true).(*MongoStore)
	ctx := context.Background()
	p := stageAndPublish(t, store, starterConfiguration(), 0)
	baseHead, _ := store.Configuration(testCompany).Head(ctx)
	native, _ := nativeDatabase(store.Client)
	foreign := primitive.NewObjectID()
	for _, variant := range []string{"absent", "null", "zero", "organisation-only", "project-only", "foreign-organisation", "foreign-project", "canonical-over-owner", "zero-owner"} {
		t.Run(variant, func(t *testing.T) {
			rawBytes, _ := bson.Marshal(p)
			var raw bson.M
			bson.Unmarshal(rawBytes, &raw)
			raw["_id"] = primitive.NewObjectID()
			raw["ownerId"] = testCompany
			switch variant {
			case "absent":
				delete(raw, "organisationId")
				delete(raw, "projectId")
			case "null":
				raw["organisationId"] = nil
				raw["projectId"] = nil
			case "zero":
				raw["organisationId"] = primitive.NilObjectID
				raw["projectId"] = primitive.NilObjectID
			case "organisation-only":
				delete(raw, "projectId")
			case "project-only":
				delete(raw, "organisationId")
			case "foreign-organisation":
				raw["organisationId"] = foreign
			case "foreign-project":
				raw["projectId"] = foreign
			case "canonical-over-owner":
				raw["ownerId"] = foreign
			case "zero-owner":
				delete(raw, "organisationId")
				delete(raw, "projectId")
				raw["ownerId"] = primitive.NilObjectID
			}
			if _, err := store.Client.InsertOne(ctx, store.Name, "accounting_configuration_versions", raw); err != nil {
				t.Fatal(err)
			}
			cfg := store.Configuration(testCompany)
			headBytes, _ := bson.Marshal(baseHead)
			var rawHead bson.M
			bson.Unmarshal(headBytes, &rawHead)
			for _, axis := range []string{"organisationId", "projectId", "ownerId"} {
				delete(rawHead, axis)
				if value, ok := raw[axis]; ok {
					rawHead[axis] = value
				}
			}
			if _, err := native.Client.Database(store.Name).Collection("accounting_configuration").ReplaceOne(ctx, bson.M{"_id": testCompany}, rawHead); err != nil {
				t.Fatal(err)
			}
			got, err := cfg.Published(ctx, raw["_id"].(primitive.ObjectID))
			if strings.HasPrefix(variant, "foreign") || variant == "zero-owner" {
				if !errors.Is(err, ErrNotFound) {
					t.Fatal("canonical foreign precedence lost", err)
				}
				if _, err := cfg.Head(ctx); !errors.Is(err, ErrNotFound) {
					t.Fatal("foreign head visible", err)
				}
				if err := cfg.SaveStage(ctx, baseHead.Stage, 1); !errors.Is(err, ErrConflict) {
					t.Fatal("foreign stage writable", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err = cfg.Reassert(ctx, got); err != nil {
				t.Fatal("owner-only publication required migration", err)
			}
			head, err := cfg.Head(ctx)
			if err != nil {
				t.Fatal("head required backfill", err)
			}
			stage := head.Stage
			stage.Version++
			stage.PublicationID = primitive.NewObjectID()
			if err = cfg.SaveStage(ctx, stage, head.Stage.Version); err != nil {
				t.Fatal("stage required backfill", err)
			}
			if err = cfg.Activate(ctx, got, 0); err != nil {
				t.Fatal("default required backfill", err)
			}
			if got.OrganisationID != testCompany || got.ProjectID != testCompany {
				t.Fatal("published axes not interpreted independently")
			}
		})
	}
}
func configurationDiskProof(t *testing.T, phase string) {
	ctx := context.Background()
	company := primitive.ObjectID{9}
	store, err := OpenMongo(ctx, os.Getenv("ODEE_TEST_MONGODB_URI"), "odee_test_config_disk", company)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Client.Disconnect(ctx)
	id := primitive.ObjectID{8}
	if phase == "write" {
		p := stageAndPublishForCompany(t, store, starterConfiguration(), 0, company)
		cfg := store.Configuration(company)
		if err = cfg.Activate(ctx, p, 0); err != nil {
			t.Fatal(err)
		}
		doc, _ := NewDocument(draft("invoice"), company, ConfigurationSelection{VersionID: &p.ID, Digest: p.Payload.Digest})
		doc.ID = id
		doc.Post(p.Payload.Data)
		doc.attribute(context.WithValue(ctx, principalKey{}, "development:local"), "document.post")
		base := doc
		base.Status = "draft"
		base.Entries = []Entry{}
		base.FinancialSnapshot = nil
		base.pendingEvent = nil
		if err = store.Create(ctx, base); err != nil {
			t.Fatal(err)
		}
		if err = store.Save(ctx, doc, 1); err != nil {
			t.Fatal(err)
		}
		v2 := stageAndPublishForCompany(t, store, syntheticV2(), 1, company)
		if err = cfg.Activate(ctx, v2, 1); err != nil {
			t.Fatal(err)
		}
		doc, _ = store.Get(ctx, id)
		if err = doc.RecordPayment(Payment{ID: "disk-original", Date: doc.Date, Amount: 10000}); err != nil {
			t.Fatal(err)
		}
		doc.attribute(context.WithValue(ctx, principalKey{}, "development:local"), "manual-payment.record")
		if err = store.Save(ctx, doc, doc.Version); err != nil {
			t.Fatal(err)
		}
		stageAndPublishForCompany(t, store, starterConfiguration(), 2, company)
	}
	doc, err := store.Get(ctx, id)
	if err != nil || doc.Total-doc.Paid != 14200 || len(doc.FinancialEvents) != 2 || doc.FinancialSnapshot == nil || !reflect.DeepEqual(doc.Payments[0].Entries, []Entry{{"1000", 10000, 0}, {"1100", 0, 10000}}) {
		t.Fatal("disk lost whole financial commit", err, doc)
	}
	head, err := store.Configuration(company).Head(ctx)
	if err != nil || head.Default.Revision != 2 || head.Stage.Version != 3 {
		t.Fatal("disk pointer or stage lost", err)
	}
	orphan, err := store.Configuration(company).Published(ctx, head.Stage.PublicationID)
	if err != nil || orphan.ID == *head.Default.VersionID {
		t.Fatal("publication-before-pointer crash state not retained", err)
	}
	t.Log(fmt.Sprintf("configuration disk %s: V1 snapshot/payment+2 events, V2 default, V3 durable inactive", phase))
}
