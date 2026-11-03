package accounting

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestMongoPersistenceIsolationAndAtomicity(t *testing.T) {
	uri := os.Getenv("ODEE_TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("run web npm run test:mongo for isolated real-MongoDB integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	name := "odee_test_" + primitive.NewObjectID().Hex()
	company, other := primitive.NewObjectID(), primitive.NewObjectID()
	store, err := OpenMongo(ctx, uri, name, company)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := NewDocument(draft("invoice"), company)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Create(ctx, doc); err != nil {
		t.Fatal(err)
	}
	if err := store.Client.Disconnect(ctx); err != nil {
		t.Fatal(err)
	}
	store, err = OpenMongo(ctx, uri, name, company)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Client.Disconnect(context.Background()); err != nil {
			t.Error(err)
		}
	})
	reloaded, err := store.Get(ctx, doc.ID)
	if err != nil || reloaded.Total != 24200 {
		t.Fatalf("persisted reload: %v %+v", err, reloaded)
	}
	foreign := &MongoStore{store.Client, name, other}
	if _, err := foreign.Get(ctx, doc.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("cross-company read was allowed")
	}
	docs, err := foreign.List(ctx)
	if err != nil || len(docs) != 0 {
		t.Fatal("cross-company list was allowed", err)
	}
	if err := doc.Post(); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, doc, 1); err != nil {
		t.Fatal(err)
	}
	doc, err = store.Get(ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"p1", "p2"} {
		wg.Go(func() {
			copy := clone(doc)
			if err := copy.RecordPayment(Payment{ID: key, Date: copy.Date, Amount: 10000}); err != nil {
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
		t.Fatalf("concurrent save success=%d conflict=%d", success, conflict)
	}
	saved, err := store.Get(ctx, doc.ID)
	if err != nil || saved.Paid != 10000 || len(saved.Payments) != 1 || !Balanced(saved.Payments[0].Entries) {
		t.Fatal("payment and journal were not atomically persisted", err)
	}
	legacy, _ := NewDocument(draft("bill"), company)
	raw, err := bson.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	var legacyDoc bson.M
	if err := bson.Unmarshal(raw, &legacyDoc); err != nil {
		t.Fatal(err)
	}
	delete(legacyDoc, "organisationId")
	delete(legacyDoc, "projectId")
	legacyDoc["ownerId"] = company
	if _, err := store.Client.InsertOne(ctx, name, "accounting_documents", legacyDoc); err != nil {
		t.Fatal(err)
	}
	found, err := store.Get(ctx, legacy.ID)
	if err != nil || found.OrganisationID != company || found.ProjectID != company {
		t.Fatal("legacy ownership not readable without backfill", err)
	}
	if err := found.Post(); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, found, found.Version); err != nil {
		t.Fatal("legacy ownership not writable without backfill", err)
	}
	legacyDoc["_id"] = primitive.NewObjectID()
	legacyDoc["number"] = "canonical-other"
	legacyDoc["organisationId"] = other
	if _, err := store.Client.InsertOne(ctx, name, "accounting_documents", legacyDoc); err != nil {
		t.Fatal(err)
	}
	docs, err = store.List(ctx)
	if err != nil || len(docs) != 2 {
		t.Fatalf("canonical ownership precedence failed: %d docs, %v", len(docs), err)
	}
}
