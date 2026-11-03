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
	"go.mongodb.org/mongo-driver/mongo"
)

func TestMongoContactsPersistenceIsolationAndSources(t *testing.T) {
	uri := os.Getenv("ODEE_TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("run npm run test:mongo")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	name := "odee_test_contacts_" + primitive.NewObjectID().Hex()
	company, other := primitive.NewObjectID(), primitive.NewObjectID()
	store, err := OpenMongo(ctx, uri, name, company)
	if err != nil {
		t.Fatal(err)
	}
	contacts, err := NewMongoContacts(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	item, err := newContact(sampleContact(), company)
	if err != nil {
		t.Fatal(err)
	}
	item.Odoo = &OdooContactSource{Origin: "https://odoo.example.invalid", Database: "test", ID: 11, CompanyID: 1, ImportedAt: time.Now().UTC()}
	if err := contacts.Create(ctx, item); err != nil {
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
	contacts, err = NewMongoContacts(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := contacts.Get(ctx, item.ID)
	if err != nil || loaded.Name != item.Name || loaded.Email != item.Email || loaded.Address.City != "Brussels" || loaded.Odoo.ID != 11 {
		t.Fatal("contact profile/source BSON roundtrip failed", err)
	}
	loaded.Name = "Edited locally"
	if err := contacts.Save(ctx, loaded, 1); err != nil {
		t.Fatal(err)
	}
	if err := contacts.Save(ctx, loaded, 1); !errors.Is(err, ErrConflict) {
		t.Fatal("stale contact writes allowed", err)
	}
	foreign, err := NewMongoContacts(ctx, &MongoStore{store.Client, name, other})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := foreign.Get(ctx, item.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign company read allowed", err)
	}
	if _, err := foreign.ByOdoo(ctx, *item.Odoo); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign company source lookup allowed", err)
	}
	if list, err := foreign.List(ctx); err != nil || len(list) != 0 {
		t.Fatal("foreign contact list leaked", err)
	}
	foreignItem := cloneContact(item)
	foreignItem.ID, foreignItem.OrganisationID, foreignItem.ProjectID = primitive.NewObjectID(), other, other
	if err := foreign.Create(ctx, foreignItem); err != nil {
		t.Fatal("source IDs must be scoped per company", err)
	}
	legacy, err := newContact(sampleContact(), company)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := bson.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	var record bson.M
	if err := bson.Unmarshal(raw, &record); err != nil {
		t.Fatal(err)
	}
	delete(record, "organisationId")
	delete(record, "projectId")
	record["ownerId"] = company
	if _, err := store.Client.InsertOne(ctx, name, "contacts", record); err != nil {
		t.Fatal(err)
	}
	loaded, err = contacts.Get(ctx, legacy.ID)
	if err != nil || loaded.OrganisationID != company || loaded.ProjectID != company {
		t.Fatal("legacy contact requires migration", err)
	}
	if err := contacts.Save(ctx, loaded, 1); err != nil {
		t.Fatal("legacy contact not writable", err)
	}
	record["_id"], record["organisationId"] = primitive.NewObjectID(), other
	if _, err := store.Client.InsertOne(ctx, name, "contacts", record); err != nil {
		t.Fatal(err)
	}
	if _, err := contacts.Get(ctx, record["_id"].(primitive.ObjectID)); !errors.Is(err, ErrNotFound) {
		t.Fatal("canonical organisation must override owner", err)
	}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			next := cloneContact(item)
			next.ID = primitive.NewObjectID()
			next.Odoo.ID = 99
			results <- contacts.Create(ctx, next)
		})
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if mongo.IsDuplicateKeyError(err) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("duplicate source race: success=%d conflict=%d", success, conflict)
	}
}
