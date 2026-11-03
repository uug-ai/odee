package accounting

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"time"

	"github.com/uug-ai/database/pkg/database"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/gridfs"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const MaxFileBytes = 20 * 1024 * 1024

type Scan struct {
	Method   string   `json:"method" bson:"method"`
	Pages    int      `json:"pages" bson:"pages"`
	Text     string   `json:"text" bson:"text"`
	Currency string   `json:"currency" bson:"currency"`
	Subtotal int64    `json:"subtotal" bson:"subtotal"`
	Tax      int64    `json:"tax" bson:"tax"`
	TaxKnown bool     `json:"taxKnown" bson:"taxKnown"`
	Total    int64    `json:"total" bson:"total"`
	Draft    Draft    `json:"draft" bson:"draft"`
	Warnings []string `json:"warnings" bson:"warnings"`
}

type BillImport struct {
	ID             primitive.ObjectID  `json:"id" bson:"id"`
	OrganisationID primitive.ObjectID  `json:"-" bson:"organisationId"`
	ProjectID      primitive.ObjectID  `json:"-" bson:"projectId"`
	OwnerID        primitive.ObjectID  `json:"-" bson:"ownerId,omitempty"`
	Filename       string              `json:"filename" bson:"filename"`
	ContentType    string              `json:"contentType" bson:"contentType"`
	Size           int64               `json:"size" bson:"size"`
	SHA256         string              `json:"sha256" bson:"sha256"`
	Status         string              `json:"status" bson:"status"`
	Error          string              `json:"error" bson:"error"`
	Version        int64               `json:"version" bson:"version"`
	DocumentID     *primitive.ObjectID `json:"documentId,omitempty" bson:"documentId,omitempty"`
	Scan           Scan                `json:"scan" bson:"scan"`
	CreatedAt      time.Time           `json:"createdAt" bson:"createdAt"`
	UpdatedAt      time.Time           `json:"updatedAt" bson:"updatedAt"`
}

func (b *BillImport) normalize() {
	if b.OrganisationID.IsZero() {
		b.OrganisationID = b.OwnerID
	}
	if b.ProjectID.IsZero() {
		b.ProjectID = b.OwnerID
	}
}

func emptyScan() Scan {
	return Scan{Draft: Draft{Kind: "bill", Lines: []Line{{Description: "Imported bill - review line details", Quantity: 1, AccountCode: "5000"}}}, Warnings: []string{}}
}

type ImportStore interface {
	List(context.Context) ([]BillImport, error)
	Get(context.Context, primitive.ObjectID) (BillImport, error)
	ByHash(context.Context, string) (BillImport, error)
	Upload(context.Context, BillImport, []byte) error
	Bytes(context.Context, primitive.ObjectID) ([]byte, error)
	Save(context.Context, BillImport, int64) error
}

type MongoImports struct {
	store  *MongoStore
	native *mongo.Database
	disk   *diskOriginals
}

type storedImport struct {
	ID             primitive.ObjectID `bson:"_id"`
	Metadata       BillImport         `bson:"metadata"`
	StorageBackend string             `bson:"storageBackend"`
	StorageKey     string             `bson:"storageKey"`
}

func NewMongoImports(ctx context.Context, store *MongoStore) (*MongoImports, error) {
	return newMongoImports(ctx, store, nil)
}

func newMongoImports(ctx context.Context, store *MongoStore, disk *diskOriginals) (*MongoImports, error) {
	client, ok := store.Client.(*database.MongoClient)
	if !ok {
		return nil, fmt.Errorf("GridFS requires the native shared MongoDB client")
	}
	m := &MongoImports{store: store, native: client.Client.Database(store.Name), disk: disk}
	_, err := m.native.Collection("bill_imports.files").Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "metadata.organisationId", Value: 1}, {Key: "metadata.projectId", Value: 1}, {Key: "metadata.sha256", Value: 1}},
		Options: options.Index().SetUnique(true).SetPartialFilterExpression(bson.M{
			"metadata.organisationId": bson.M{"$type": "objectId", "$gt": primitive.NilObjectID},
			"metadata.projectId":      bson.M{"$type": "objectId", "$gt": primitive.NilObjectID},
			"metadata.sha256":         bson.M{"$type": "string"},
		}),
	})
	if err != nil {
		return nil, fmt.Errorf("create bill import duplicate index: %w", err)
	}
	if disk == nil {
		count, err := m.native.Collection("bill_imports.files").CountDocuments(ctx,
			m.filter(bson.M{"storageBackend": "filesystem"}), options.Count().SetLimit(1))
		if err != nil {
			return nil, fmt.Errorf("check original document storage configuration: %w", err)
		}
		if count != 0 {
			return nil, fmt.Errorf("ODEE_DOCUMENTS_DIR is required for existing filesystem originals")
		}
	}
	return m, nil
}

func NewFilesystemImports(ctx context.Context, store *MongoStore, directory string) (*MongoImports, error) {
	disk, err := newDiskOriginals(ctx, directory)
	if err != nil {
		return nil, err
	}
	return newMongoImports(ctx, store, disk)
}

func (m *MongoImports) filter(extra bson.M) bson.M {
	return bson.M{"$and": bson.A{scopeFilter(m.store.Company, "metadata."), extra}}
}

func (m *MongoImports) Get(ctx context.Context, id primitive.ObjectID) (BillImport, error) {
	return m.find(ctx, bson.M{"_id": id})
}

func (m *MongoImports) ByHash(ctx context.Context, hash string) (BillImport, error) {
	return m.find(ctx, bson.M{"metadata.sha256": hash})
}

func (m *MongoImports) find(ctx context.Context, filter bson.M) (BillImport, error) {
	file, err := m.findFile(ctx, filter)
	return file.Metadata, err
}

func (m *MongoImports) findFile(ctx context.Context, filter bson.M) (storedImport, error) {
	var file storedImport
	err := m.native.Collection("bill_imports.files").FindOne(ctx, m.filter(filter)).Decode(&file)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return storedImport{}, ErrNotFound
	}
	file.Metadata.normalize()
	file.Metadata.ID = file.ID
	return file, err
}

func (m *MongoImports) List(ctx context.Context) ([]BillImport, error) {
	cursor, err := m.native.Collection("bill_imports.files").Find(ctx, m.filter(bson.M{}),
		options.Find().SetProjection(bson.M{"metadata": 1}).SetSort(bson.D{{Key: "uploadDate", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := cursor.Close(ctx); err != nil {
			slog.Error("close import cursor", "error", err)
		}
	}()
	var files []storedImport
	if err := cursor.All(ctx, &files); err != nil {
		return nil, err
	}
	result := []BillImport{}
	for _, file := range files {
		file.Metadata.normalize()
		file.Metadata.ID = file.ID
		result = append(result, file.Metadata)
	}
	return result, nil
}

func (m *MongoImports) bucket(ctx context.Context) (*gridfs.Bucket, error) {
	bucket, err := gridfs.NewBucket(m.native, options.GridFSBucket().SetName("bill_imports"))
	if err != nil {
		return nil, err
	}
	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(30 * time.Second)
	}
	if err := bucket.SetReadDeadline(deadline); err != nil {
		return nil, err
	}
	if err := bucket.SetWriteDeadline(deadline); err != nil {
		return nil, err
	}
	return bucket, nil
}

func (m *MongoImports) Upload(ctx context.Context, item BillImport, data []byte) error {
	if item.OrganisationID != m.store.Company || item.ProjectID != m.store.Company {
		return ErrNotFound
	}
	existing, err := m.native.Collection("bill_imports.files").CountDocuments(ctx, bson.M{"_id": item.ID})
	if err != nil {
		return err
	}
	if existing != 0 {
		return ErrConflict
	}
	if m.disk != nil {
		if err := m.disk.write(ctx, item, data); err != nil {
			return err
		}
		_, err := m.native.Collection("bill_imports.files").InsertOne(ctx, bson.M{
			"_id": item.ID, "filename": item.Filename, "length": item.Size,
			"uploadDate": item.CreatedAt, "metadata": item,
			"storageBackend": "filesystem", "storageKey": item.SHA256,
		})
		if err != nil && !mongo.IsDuplicateKeyError(err) {
			// A failed acknowledgement may still have committed; never remove its original.
			slog.Error("document metadata write failed; synced original retained for retry/recovery", "import", item.ID.Hex(), "error", err)
		}
		return err
	}
	bucket, err := m.bucket(ctx)
	if err != nil {
		return err
	}
	err = bucket.UploadFromStreamWithID(item.ID, item.Filename, bytes.NewReader(data), options.GridFSUpload().SetMetadata(item))
	if err != nil {
		// Never delete an existing original if a reused ID caused the upload to fail.
		count, checkErr := m.native.Collection("bill_imports.files").CountDocuments(ctx, bson.M{"_id": item.ID})
		if checkErr != nil {
			slog.Error("check failed GridFS upload before cleanup", "error", checkErr)
		} else if count == 0 {
			if _, cleanupErr := m.native.Collection("bill_imports.chunks").DeleteMany(ctx, bson.M{"files_id": item.ID}); cleanupErr != nil {
				slog.Error("clean uncommitted GridFS chunks", "error", cleanupErr)
			}
		}
	}
	return err
}

func (m *MongoImports) Bytes(ctx context.Context, id primitive.ObjectID) ([]byte, error) {
	file, err := m.findFile(ctx, bson.M{"_id": id})
	if err != nil {
		return nil, err
	}
	switch file.StorageBackend {
	case "filesystem":
		if m.disk == nil {
			return nil, fmt.Errorf("filesystem originals require ODEE_DOCUMENTS_DIR; refusing GridFS fallback")
		}
		return m.disk.read(ctx, file.Metadata, file.StorageKey)
	case "", "gridfs":
	default:
		return nil, fmt.Errorf("unsupported original document storage backend %q", file.StorageBackend)
	}
	bucket, err := m.bucket(ctx)
	if err != nil {
		return nil, err
	}
	stream, err := bucket.OpenDownloadStream(id)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := stream.Close(); err != nil {
			slog.Error("close original download", "error", err)
		}
	}()
	data, err := io.ReadAll(io.LimitReader(stream, MaxFileBytes+1))
	if err == nil && len(data) > MaxFileBytes {
		return nil, invalid("stored original exceeds the file limit")
	}
	return data, err
}

func (m *MongoImports) Save(ctx context.Context, item BillImport, version int64) error {
	item.normalize()
	if item.OrganisationID != m.store.Company || item.ProjectID != m.store.Company {
		return ErrNotFound
	}
	item.Version, item.UpdatedAt = version+1, time.Now().UTC()
	result, err := m.native.Collection("bill_imports.files").UpdateOne(ctx,
		m.filter(bson.M{"_id": item.ID, "metadata.version": version}), bson.M{"$set": bson.M{"metadata": item}})
	if err != nil {
		return err
	}
	if result.MatchedCount == 0 {
		return ErrConflict
	}
	return nil
}

type MemoryImports struct {
	mu      sync.Mutex
	company primitive.ObjectID
	items   map[primitive.ObjectID]BillImport
	data    map[primitive.ObjectID][]byte
}

func NewMemoryImports(company primitive.ObjectID) *MemoryImports {
	return &MemoryImports{company: company, items: map[primitive.ObjectID]BillImport{}, data: map[primitive.ObjectID][]byte{}}
}

func cloneImport(item BillImport) BillImport {
	item.Scan.Draft.Lines = append([]Line{}, item.Scan.Draft.Lines...)
	item.Scan.Warnings = append([]string{}, item.Scan.Warnings...)
	return item
}

func (m *MemoryImports) List(context.Context) ([]BillImport, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := []BillImport{}
	for _, item := range m.items {
		items = append(items, cloneImport(item))
	}
	return items, nil
}

func (m *MemoryImports) Get(_ context.Context, id primitive.ObjectID) (BillImport, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.items[id]
	if !ok {
		return BillImport{}, ErrNotFound
	}
	return cloneImport(item), nil
}

func (m *MemoryImports) ByHash(_ context.Context, hash string) (BillImport, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, item := range m.items {
		if item.SHA256 == hash {
			return cloneImport(item), nil
		}
	}
	return BillImport{}, ErrNotFound
}

func (m *MemoryImports) Upload(_ context.Context, item BillImport, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if item.OrganisationID != m.company || item.ProjectID != m.company {
		return ErrNotFound
	}
	for _, existing := range m.items {
		if existing.SHA256 == item.SHA256 {
			return ErrConflict
		}
		var size int
		for _, data := range m.data {
			size += len(data)
		}
		if size+len(data) > 200*1024*1024 {
			return invalid("temporary demo originals are limited to 200 MiB; configure MongoDB for persistent storage")
		}
	}
	m.items[item.ID], m.data[item.ID] = cloneImport(item), append([]byte{}, data...)
	return nil
}

func (m *MemoryImports) Bytes(_ context.Context, id primitive.ObjectID) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.data[id]
	if !ok {
		return nil, ErrNotFound
	}
	return append([]byte{}, data...), nil
}

func (m *MemoryImports) Save(_ context.Context, item BillImport, version int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	current, ok := m.items[item.ID]
	if !ok {
		return ErrNotFound
	}
	if current.Version != version {
		return ErrConflict
	}
	item.Version, item.UpdatedAt = version+1, time.Now().UTC()
	m.items[item.ID] = cloneImport(item)
	return nil
}
