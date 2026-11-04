package accounting

import (
	"bytes"
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestMongoGridFSOriginalsAndOwnership(t *testing.T) {
	uri := os.Getenv("ODEE_TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("run npm run test:mongo")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	name, company, other := "odee_import_test_"+primitive.NewObjectID().Hex(), primitive.NewObjectID(), primitive.NewObjectID()
	store, err := OpenMongo(ctx, uri, name, company)
	if err != nil {
		t.Fatal(err)
	}
	originals, err := NewMongoImports(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	data := samplePDF(sampleText)
	item := importMetadata(company, data)
	if err := originals.Upload(ctx, item, data); err != nil {
		t.Fatal(err)
	}
	if err := originals.Upload(ctx, item, []byte("different bytes")); !errors.Is(err, ErrConflict) {
		t.Fatal("reused ID must be rejected before touching original chunks", err)
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
	originals, err = NewMongoImports(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := originals.Bytes(ctx, item.ID)
	if err != nil || !bytes.Equal(data, reloaded) {
		t.Fatal("original did not survive reconnect/reused upload", err)
	}
	item.Scan, item.Status = extract(sampleText), "ready"
	if err := originals.Save(ctx, item, 1); err != nil {
		t.Fatal(err)
	}
	saved, err := originals.Get(ctx, item.ID)
	if err != nil || saved.Version != 2 || saved.Scan.Draft.DueDate != "2026-12-03" {
		t.Fatal("scan metadata BSON roundtrip failed", err)
	}
	if err := originals.Save(ctx, item, 1); !errors.Is(err, ErrConflict) {
		t.Fatal("stale import update was allowed", err)
	}
	foreign, err := NewMongoImports(ctx, &MongoStore{store.Client, name, other})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := foreign.Bytes(ctx, item.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("cross-company original download allowed", err)
	}
	if _, err := foreign.ByHash(ctx, item.SHA256); !errors.Is(err, ErrNotFound) {
		t.Fatal("cross-company hash lookup allowed", err)
	}
	if list, err := foreign.List(ctx); err != nil || len(list) != 0 {
		t.Fatal("cross-company list allowed", err)
	}
	foreignItem := importMetadata(other, data)
	if err := foreign.Upload(ctx, foreignItem, data); err != nil {
		t.Fatal("duplicates must be company-scoped", err)
	}
	duplicate := importMetadata(company, data)
	if err := originals.Upload(ctx, duplicate, data); !mongo.IsDuplicateKeyError(err) {
		t.Fatal("duplicate SHA not rejected", err)
	}
	if count, err := originals.native.Collection("bill_imports.chunks").CountDocuments(ctx, bson.M{"files_id": duplicate.ID}); err != nil || count != 0 {
		t.Fatal("failed duplicate upload left orphaned chunks", err)
	}
	if preserved, err := originals.Bytes(ctx, item.ID); err != nil || !bytes.Equal(preserved, data) {
		t.Fatal("duplicate cleanup damaged original", err)
	}
	legacy := importMetadata(company, append(data, '\n'))
	raw, err := bson.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	var metadata bson.M
	if err := bson.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	delete(metadata, "organisationId")
	delete(metadata, "projectId")
	delete(metadata, "id")
	metadata["ownerId"] = company
	bucket, err := originals.bucket(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := bucket.UploadFromStreamWithID(legacy.ID, "legacy.pdf", bytes.NewReader(data), options.GridFSUpload().SetMetadata(metadata)); err != nil {
		t.Fatal(err)
	}
	loaded, err := originals.Get(ctx, legacy.ID)
	if err != nil || loaded.ID != legacy.ID || loaded.OrganisationID != company || loaded.ProjectID != company {
		t.Fatal("legacy original requires backfill", err)
	}

	if _, err := originals.Bytes(ctx, legacy.ID); err != nil {
		t.Fatal("legacy original not downloadable", err)
	}
	if err := originals.Save(ctx, loaded, 1); err != nil {
		t.Fatal("legacy original not writable", err)
	}
	metadata["id"], metadata["organisationId"] = primitive.NewObjectID(), other
	precedence := metadata["id"].(primitive.ObjectID)
	if err := bucket.UploadFromStreamWithID(precedence, "canonical.pdf", bytes.NewReader(data), options.GridFSUpload().SetMetadata(metadata)); err != nil {
		t.Fatal(err)
	}
	if _, err := originals.Bytes(ctx, precedence); !errors.Is(err, ErrNotFound) {
		t.Fatal("canonical organisation must win over owner", err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	raceData := append(append([]byte{}, data...), []byte("\n% concurrent")...)
	for range 2 {
		wg.Go(func() { results <- originals.Upload(ctx, importMetadata(company, raceData), raceData) })
	}
	wg.Wait()
	close(results)
	success, rejected := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if mongo.IsDuplicateKeyError(err) {
			rejected++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || rejected != 1 {
		t.Fatalf("concurrent duplicate: success=%d rejected=%d", success, rejected)
	}
}

func TestMongoDiskPersistence(t *testing.T) {
	phase := os.Getenv("ODEE_TEST_RESTART_PHASE")
	if phase == "" {
		t.Skip("run npm run test:mongo for daemon-restart verification")
	}
	t.Run("configuration", func(t *testing.T) { configurationDiskProof(t, phase) })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	company := primitive.ObjectID{2}
	store, err := OpenMongo(ctx, os.Getenv("ODEE_TEST_MONGODB_URI"), "odee_test_disk_persistence", company)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := store.Client.Disconnect(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	originals, err := NewMongoImports(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	id := primitive.ObjectID{1}
	data := samplePDF(sampleText)
	if phase == "write" {
		item := importMetadata(company, data)
		item.ID, item.Status, item.DocumentID = id, "draft", &id
		if err := originals.Upload(ctx, item, data); err != nil {
			t.Fatal(err)
		}
		doc, err := NewDocument(draft("bill"), company)
		if err != nil {
			t.Fatal(err)
		}
		doc.ID, doc.SourceID = id, &id
		if err := store.Create(ctx, doc); err != nil {
			t.Fatal(err)
		}
	} else if phase != "read" {
		t.Fatal("unknown restart verification phase")
	}
	doc, err := store.Get(ctx, id)
	if err != nil || doc.SourceID == nil || *doc.SourceID != id || doc.Total != 24200 || doc.Status != "draft" {
		t.Fatal("bill did not persist across daemon restart", err)
	}
	original, err := originals.Bytes(ctx, id)
	if err != nil || !bytes.Equal(original, data) {
		t.Fatal("original did not persist across daemon restart", err)
	}
}
