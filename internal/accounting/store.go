package accounting

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/uug-ai/database/pkg/database"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Store interface {
	Configuration(primitive.ObjectID) ConfigurationStore
	List(context.Context) ([]Document, error)
	Get(context.Context, primitive.ObjectID) (Document, error)
	Create(context.Context, Document) error
	Save(context.Context, Document, int64) error
}

type MongoStore struct {
	Client  database.DatabaseInterface
	Name    string
	Company primitive.ObjectID
}

func ScopeFilter(company primitive.ObjectID) bson.M {
	return scopeFilter(company, "")
}

func scopeFilter(company primitive.ObjectID, prefix string) bson.M {
	axis := func(name string) bson.M {
		name = prefix + name
		return bson.M{"$or": bson.A{
			bson.M{name: company},
			bson.M{"$and": bson.A{
				bson.M{name: bson.M{"$in": bson.A{nil, "", primitive.NilObjectID}}},
				bson.M{prefix + "ownerId": company},
			}},
		}}
	}
	return bson.M{"$and": bson.A{axis("organisationId"), axis("projectId")}}
}

func OpenMongo(ctx context.Context, uri, name string, company primitive.ObjectID) (*MongoStore, error) {
	// One long-running OLTP client; keep driver pool defaults until measured.
	opts := database.NewMongoOptions().SetUri(uri).
		SetRetryWrites(true).SetTimeout(10000).Build()
	db, err := database.New(opts)
	if err != nil {
		return nil, fmt.Errorf("connect MongoDB: %w", err)
	}
	store := &MongoStore{db.Client, name, company}
	if err := store.Client.Ping(ctx); err != nil {
		store.closeAfterError()
		return nil, fmt.Errorf("ping MongoDB: %w", err)
	}
	indexer, ok := store.Client.(database.IndexManager)
	if !ok {
		store.closeAfterError()
		return nil, fmt.Errorf("MongoDB client does not support required indexes")
	}
	_, err = indexer.CreateIndexes(ctx, name, "accounting_documents", []mongo.IndexModel{
		{Keys: bson.D{{Key: "organisationId", Value: 1}, {Key: "projectId", Value: 1}, {Key: "date", Value: -1}}},
		{Keys: bson.D{{Key: "number", Value: 1}}, Options: options.Index().SetUnique(true)},
	})
	if err != nil {
		store.closeAfterError()
		return nil, fmt.Errorf("create accounting indexes: %w", err)
	}
	for _, index := range []bson.D{
		{{Key: "organisationId", Value: 1}, {Key: "projectId", Value: 1}, {Key: "payload.publishedAt", Value: -1}, {Key: "_id", Value: -1}},
		{{Key: "ownerId", Value: 1}, {Key: "payload.publishedAt", Value: -1}, {Key: "_id", Value: -1}},
	} {
		if _, err = indexer.CreateIndexes(ctx, name, "accounting_configuration_versions", []mongo.IndexModel{{Keys: index}}); err != nil {
			store.closeAfterError()
			return nil, err
		}
	}
	native, ok := nativeDatabase(store.Client)
	if !ok {
		store.closeAfterError()
		return nil, fmt.Errorf("durable accounting requires native MongoDB client")
	}
	store.Client = &durableDatabase{store.Client, native}
	return store, nil
}

func (s *MongoStore) closeAfterError() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Client.Disconnect(ctx); err != nil {
		slog.Error("MongoDB startup cleanup failed", "error", err)
	}
}

func (s *MongoStore) filter(id primitive.ObjectID) bson.M {
	return bson.M{"$and": bson.A{ScopeFilter(s.Company), bson.M{"_id": id}}}
}

func (s *MongoStore) List(ctx context.Context) ([]Document, error) {
	docs := []Document{}
	err := s.Client.Find(ctx, s.Name, "accounting_documents", ScopeFilter(s.Company),
		options.Find().SetSort(bson.D{{Key: "date", Value: -1}, {Key: "_id", Value: -1}})).All(&docs)
	for i := range docs {
		docs[i].NormalizeOwnership()
	}
	return docs, err
}

func (s *MongoStore) Get(ctx context.Context, id primitive.ObjectID) (Document, error) {
	var doc Document
	err := s.Client.FindOne(ctx, s.Name, "accounting_documents", s.filter(id)).Into(&doc)
	if err == mongo.ErrNoDocuments {
		return Document{}, ErrNotFound
	}
	doc.NormalizeOwnership()
	return doc, err
}

func (s *MongoStore) Create(ctx context.Context, doc Document) error {
	doc.NormalizeOwnership()
	if doc.OrganisationID != s.Company || doc.ProjectID != s.Company {
		return invalid("document does not belong to configured company")
	}
	if err := documentSize(doc); err != nil {
		return err
	}
	_, err := s.Client.InsertOne(ctx, s.Name, "accounting_documents", doc)
	if err != nil && !mongo.IsDuplicateKeyError(err) {
		return fmt.Errorf("%w: %w", ErrUncertain, err)
	}
	return err
}

func (s *MongoStore) Save(ctx context.Context, doc Document, version int64) error {
	doc.NormalizeOwnership()
	if doc.OrganisationID != s.Company || doc.ProjectID != s.Company {
		return ErrNotFound
	}
	filter := s.filter(doc.ID)
	filter["version"] = version
	doc.Version, doc.UpdatedAt = version+1, time.Now().UTC()
	if err := documentSize(doc); err != nil {
		return err
	}
	update := bson.M{"$set": bson.M{
		"organisationId": doc.OrganisationID, "projectId": doc.ProjectID,
		"version": doc.Version, "updatedAt": doc.UpdatedAt, "partner": doc.Partner,
		"email": doc.Email, "reference": doc.Reference, "date": doc.Date, "dueDate": doc.DueDate,
		"lines": doc.Lines, "subtotal": doc.Subtotal, "tax": doc.Tax, "total": doc.Total,
		"status": doc.Status, "entries": doc.Entries, "payments": doc.Payments, "paid": doc.Paid,
		"partnerSnapshot": doc.PartnerSnapshot, "ownCompanySnapshot": doc.OwnCompanySnapshot,
		"configurationSelection": doc.ConfigurationSelection, "journalCode": doc.JournalCode, "financialSnapshot": doc.FinancialSnapshot,
	}}
	if doc.pendingEvent != nil {
		filter["status"] = "draft"
		if doc.pendingEvent.Action == "manual-payment.record" {
			filter["status"] = "posted"
		}
		if doc.pendingEvent.Version != version+1 || doc.pendingEvent.TargetID != doc.ID {
			return invalid("invalid financial event version or target")
		}
		filter["$expr"] = bson.M{"$lt": bson.A{bson.M{"$size": bson.M{"$ifNull": bson.A{"$financialEvents", bson.A{}}}}, MaxFinancialEvents}}
		update["$push"] = bson.M{"financialEvents": *doc.pendingEvent}
	}
	result, err := s.Client.UpdateOne(ctx, s.Name, "accounting_documents", filter, update)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrUncertain, err)
	}
	if result.MatchedCount() == 0 {
		return ErrConflict
	}
	return nil
}

type MemoryStore struct {
	mu                    sync.Mutex
	docs                  map[primitive.ObjectID]Document
	configurationHeads    map[primitive.ObjectID]ConfigurationHead
	configurationVersions map[primitive.ObjectID]PublishedConfiguration
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{docs: map[primitive.ObjectID]Document{}}
}

func clone(doc Document) Document {
	if doc.ConfigurationSelection != nil {
		value := copyConfiguration(*doc.ConfigurationSelection)
		doc.ConfigurationSelection = &value
	}
	if doc.FinancialSnapshot != nil {
		value := copyConfiguration(*doc.FinancialSnapshot)
		doc.FinancialSnapshot = &value
	}
	if doc.PartnerSnapshot != nil {
		copy := *doc.PartnerSnapshot
		copy.Data = cloneData(copy.Data)
		doc.PartnerSnapshot = &copy
	}
	if doc.OwnCompanySnapshot != nil {
		copy := *doc.OwnCompanySnapshot
		copy.Data = cloneData(copy.Data)
		doc.OwnCompanySnapshot = &copy
	}
	doc.FinancialEvents = append([]FinancialEvent{}, doc.FinancialEvents...)
	if doc.pendingEvent != nil {
		event := *doc.pendingEvent
		doc.pendingEvent = &event
	}
	doc.Lines = append([]Line{}, doc.Lines...)
	doc.Entries = append([]Entry{}, doc.Entries...)
	doc.Payments = append([]Payment{}, doc.Payments...)
	for i := range doc.Payments {
		doc.Payments[i].Entries = append([]Entry{}, doc.Payments[i].Entries...)
	}
	return doc
}

func (s *MemoryStore) List(context.Context) ([]Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	docs := []Document{}
	for _, doc := range s.docs {
		doc.NormalizeOwnership()
		docs = append(docs, clone(doc))
	}
	return docs, nil
}

func (s *MemoryStore) Get(_ context.Context, id primitive.ObjectID) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[id]
	if !ok {
		return Document{}, ErrNotFound
	}
	doc.NormalizeOwnership()
	return clone(doc), nil
}

func (s *MemoryStore) Create(_ context.Context, doc Document) error {
	if err := documentSize(doc); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.docs[doc.ID]; ok {
		return ErrConflict
	}
	s.docs[doc.ID] = clone(doc)
	return nil
}

func (s *MemoryStore) Save(_ context.Context, doc Document, version int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.docs[doc.ID]
	if !ok {
		return ErrNotFound
	}
	if current.Version != version {
		return ErrConflict
	}
	if err := documentSize(doc); err != nil {
		return err
	}
	current.NormalizeOwnership()
	doc.NormalizeOwnership()
	if current.OrganisationID != doc.OrganisationID || current.ProjectID != doc.ProjectID {
		return ErrNotFound
	}
	doc.FinancialEvents = append([]FinancialEvent{}, current.FinancialEvents...)
	if doc.pendingEvent != nil {
		expected := "draft"
		if doc.pendingEvent.Action == "manual-payment.record" {
			expected = "posted"
		}
		if current.Status != expected {
			return ErrConflict
		}
		if len(current.FinancialEvents) >= MaxFinancialEvents {
			return ErrConflict
		}

		if doc.pendingEvent.Version != version+1 || doc.pendingEvent.TargetID != doc.ID {
			return invalid("invalid financial event version or target")
		}
		doc.FinancialEvents = append(doc.FinancialEvents, *doc.pendingEvent)
	}
	doc.pendingEvent = nil
	doc.Version, doc.UpdatedAt = version+1, time.Now().UTC()
	s.docs[doc.ID] = clone(doc)
	return nil
}

func documentSize(doc Document) error {
	if doc.pendingEvent != nil {
		doc.FinancialEvents = append(append([]FinancialEvent{}, doc.FinancialEvents...), *doc.pendingEvent)
	}
	raw, err := bson.Marshal(doc)
	if err != nil {
		return invalid("document cannot be encoded")
	}
	if len(raw) > 16*1024*1024 {
		return invalid("document exceeds MongoDB BSON limit")
	}
	return nil
}
