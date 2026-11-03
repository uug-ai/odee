package accounting

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestMongoFilesystemOriginalsAndLegacyGridFS(t *testing.T) {
	uri := os.Getenv("ODEE_TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("run npm run test:mongo")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	company, other := primitive.NewObjectID(), primitive.NewObjectID()
	store, err := OpenMongo(ctx, uri, "odee_filesystem_test_"+primitive.NewObjectID().Hex(), company)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Client.Disconnect(context.Background()); err != nil {
			t.Error(err)
		}
	})
	grid, err := NewMongoImports(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	originals, err := NewFilesystemImports(ctx, store, directory)
	if err != nil {
		t.Fatal(err)
	}
	origin := "http://localhost:8098"
	handler := (&Server{Store: store, Imports: originals, Company: company, Dev: true, Origin: origin}).Handler()
	data := samplePDF(sampleText)
	response := uploadRequest(handler, data, "volume.pdf", origin, "")
	if response.Code != http.StatusCreated {
		t.Fatalf("filesystem HTTP upload failed: %d %s", response.Code, response.Body)
	}
	item, _ := importResponse(t, response)
	stored, err := originals.findFile(ctx, bson.M{"_id": item.ID})
	if err != nil || stored.StorageBackend != "filesystem" || stored.StorageKey != item.SHA256 {
		t.Fatal("scan metadata updates lost the immutable filesystem locator", err)
	}
	name, err := originalDiskPath(company, company, item.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	if saved, err := os.ReadFile(filepath.Join(directory, name)); err != nil || !bytes.Equal(saved, data) {
		t.Fatal("uploaded original was not actually stored on disk", err)
	}
	if count, err := originals.native.Collection("bill_imports.chunks").CountDocuments(ctx, bson.M{"files_id": item.ID}); err != nil || count != 0 {
		t.Fatal("filesystem upload wrote original bytes to GridFS", err)
	}
	if _, err := NewMongoImports(ctx, store); err == nil {
		t.Fatal("removing the volume configuration must fail startup for filesystem documents")
	}
	if _, err := grid.Bytes(ctx, item.ID); err == nil {
		t.Fatal("missing filesystem configuration must not fall back to GridFS")
	}
	duplicate := uploadRequest(handler, data, "repeat.pdf", origin, "")
	repeated, isDuplicate := importResponse(t, duplicate)
	if duplicate.Code != http.StatusOK || !isDuplicate || repeated.ID != item.ID {
		t.Fatal("HTTP duplicate did not reuse the original")
	}
	payload, err := json.Marshal(struct {
		Draft
		Reviewed bool `json:"reviewed"`
	}{draft("bill"), true})
	if err != nil {
		t.Fatal(err)
	}
	response = apiRequest(handler, "POST", "/api/imports/"+item.ID.Hex()+"/draft", string(payload), "", origin)
	if response.Code != http.StatusCreated {
		t.Fatalf("manual reviewed conversion failed: %d %s", response.Code, response.Body)
	}
	response = apiRequest(handler, "GET", "/api/imports/"+item.ID.Hex()+"/original", "", "", "")
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), data) {
		t.Fatal("download after draft conversion lost the filesystem original")
	}
	originals, err = NewFilesystemImports(ctx, store, directory)
	if err != nil {
		t.Fatal(err)
	}
	if saved, err := originals.Bytes(ctx, item.ID); err != nil || !bytes.Equal(saved, data) {
		t.Fatal("original did not survive store reconstruction", err)
	}
	if _, err := originals.native.Collection("bill_imports.files").UpdateOne(ctx, bson.M{"_id": item.ID}, bson.M{
		"$unset": bson.M{"metadata.organisationId": "", "metadata.projectId": ""},
		"$set":   bson.M{"metadata.ownerId": company},
	}); err != nil {
		t.Fatal(err)
	}
	if saved, err := originals.Bytes(ctx, item.ID); err != nil || !bytes.Equal(saved, data) {
		t.Fatal("owner-only filesystem metadata must remain readable without backfill", err)
	}
	for _, axis := range []string{"metadata.organisationId", "metadata.projectId"} {
		if _, err := originals.native.Collection("bill_imports.files").UpdateOne(ctx, bson.M{"_id": item.ID}, bson.M{"$set": bson.M{axis: other}}); err != nil {
			t.Fatal(err)
		}
		if _, err := originals.Bytes(ctx, item.ID); !errors.Is(err, ErrNotFound) {
			t.Fatal("canonical ownership must override legacy owner for filesystem originals", err)
		}
		if _, err := originals.native.Collection("bill_imports.files").UpdateOne(ctx, bson.M{"_id": item.ID}, bson.M{"$unset": bson.M{axis: ""}}); err != nil {
			t.Fatal(err)
		}
	}
	foreign, err := NewFilesystemImports(ctx, &MongoStore{store.Client, store.Name, other}, directory)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := foreign.Bytes(ctx, item.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign tenant downloaded filesystem original", err)
	}
	legacyData := append(bytes.Clone(data), []byte("\n% legacy fixture")...)
	legacy := importMetadata(company, legacyData)
	encoded, err := bson.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	var metadata bson.M
	if err := bson.Unmarshal(encoded, &metadata); err != nil {
		t.Fatal(err)
	}
	delete(metadata, "organisationId")
	delete(metadata, "projectId")
	metadata["ownerId"] = company
	bucket, err := grid.bucket(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := bucket.UploadFromStreamWithID(legacy.ID, "legacy.pdf", bytes.NewReader(legacyData), options.GridFSUpload().SetMetadata(metadata)); err != nil {
		t.Fatal(err)
	}
	if saved, err := originals.Bytes(ctx, legacy.ID); err != nil || !bytes.Equal(saved, legacyData) {
		t.Fatal("switching to disk broke legacy owner-only GridFS reads", err)
	}
	legacyLoaded, err := originals.Get(ctx, legacy.ID)
	if err != nil || legacyLoaded.OrganisationID != company || legacyLoaded.ProjectID != company {
		t.Fatal("legacy ownership required migration", err)
	}
	if err := originals.Save(ctx, legacyLoaded, legacyLoaded.Version); err != nil {
		t.Fatal(err)
	}
	if saved, err := originals.Bytes(ctx, legacy.ID); err != nil || !bytes.Equal(saved, legacyData) {
		t.Fatal("saving legacy metadata changed its backend", err)
	}
	raceData := append(bytes.Clone(data), []byte("\n% racing fixture")...)
	var group sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		group.Go(func() { results <- originals.Upload(ctx, importMetadata(company, raceData), raceData) })
	}
	group.Wait()
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
		t.Fatalf("filesystem duplicate race: success=%d conflict=%d", success, conflict)
	}
	files, err := os.ReadDir(filepath.Dir(filepath.Join(directory, name)))
	if err != nil || len(files) != 2 {
		t.Fatal("concurrent duplicates left extra original/temporary files", err)
	}
	chunks, err := originals.native.Collection("bill_imports.chunks").CountDocuments(ctx, bson.M{})
	if err != nil {
		t.Fatal(err)
	}
	originals.disk.directory = filepath.Join(directory, "unmounted")
	failedData := append(bytes.Clone(data), []byte("\n% unavailable volume fixture")...)
	failureHandler := (&Server{Store: store, Imports: originals, Company: company, Dev: true, Origin: origin}).Handler()
	if response := uploadRequest(failureHandler, failedData, "unavailable.pdf", origin, ""); response.Code != http.StatusInternalServerError {
		t.Fatal("an unavailable volume must fail the upload, never switch backends", response.Code)
	}
	if _, err := originals.ByHash(ctx, importMetadata(company, failedData).SHA256); !errors.Is(err, ErrNotFound) {
		t.Fatal("failed filesystem upload committed metadata", err)
	}
	if count, err := originals.native.Collection("bill_imports.chunks").CountDocuments(ctx, bson.M{}); err != nil || count != chunks {
		t.Fatal("unavailable filesystem fell back to GridFS chunks", err)
	}
}

func TestMongoFilesystemDiskPersistence(t *testing.T) {
	phase, directory := os.Getenv("ODEE_TEST_RESTART_PHASE"), os.Getenv("ODEE_TEST_DOCUMENTS_DIR")
	if phase == "" {
		t.Skip("run npm run test:mongo for filesystem/daemon-restart verification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	company := primitive.ObjectID{3}
	store, err := OpenMongo(ctx, os.Getenv("ODEE_TEST_MONGODB_URI"), "odee_test_filesystem_persistence", company)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := store.Client.Disconnect(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	originals, err := NewFilesystemImports(ctx, store, directory)
	if err != nil {
		t.Fatal(err)
	}
	data := samplePDF(sampleText)
	item := importMetadata(company, data)
	item.ID = primitive.ObjectID{4}
	if phase == "write" {
		if err := originals.Upload(ctx, item, data); err != nil {
			t.Fatal(err)
		}
	} else if phase != "read" {
		t.Fatal("unknown filesystem restart phase")
	}
	if saved, err := originals.Bytes(ctx, item.ID); err != nil || !bytes.Equal(saved, data) {
		t.Fatal("filesystem original/metadata did not survive separate processes and MongoDB restart", err)
	}
}
