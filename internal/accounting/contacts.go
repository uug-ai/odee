package accounting

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/uug-ai/database/pkg/database"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type ContactAddress struct {
	Street     string `json:"street" bson:"street"`
	Street2    string `json:"street2" bson:"street2"`
	PostalCode string `json:"postalCode" bson:"postalCode"`
	City       string `json:"city" bson:"city"`
	State      string `json:"state" bson:"state"`
	Country    string `json:"country" bson:"country"`
}

type ContactData struct {
	Name        string         `json:"name" bson:"name"`
	IsCompany   bool           `json:"isCompany" bson:"isCompany"`
	CompanyName string         `json:"companyName" bson:"companyName"`
	Email       string         `json:"email" bson:"email"`
	Phone       string         `json:"phone" bson:"phone"`
	Mobile      string         `json:"mobile" bson:"mobile"`
	Website     string         `json:"website" bson:"website"`
	VAT         string         `json:"vat" bson:"vat"`
	Reference   string         `json:"reference" bson:"reference"`
	Type        string         `json:"type" bson:"type"`
	Address     ContactAddress `json:"address" bson:"address"`
	Tags        []string       `json:"tags" bson:"tags"`
	Customer    bool           `json:"customer" bson:"customer"`
	Vendor      bool           `json:"vendor" bson:"vendor"`
	Active      bool           `json:"active" bson:"active"`
}

type OdooContactSource struct {
	OriginalWebsite string    `json:"originalWebsite,omitempty" bson:"originalWebsite,omitempty"`
	Origin          string    `json:"origin" bson:"origin"`
	Database        string    `json:"database" bson:"database"`
	ID              int64     `json:"id" bson:"id"`
	ParentID        int64     `json:"parentId" bson:"parentId"`
	CompanyID       int64     `json:"companyId" bson:"companyId"`
	ImportedAt      time.Time `json:"importedAt" bson:"importedAt"`
}

type Contact struct {
	ID             primitive.ObjectID `json:"id" bson:"_id"`
	OrganisationID primitive.ObjectID `json:"-" bson:"organisationId"`
	ProjectID      primitive.ObjectID `json:"-" bson:"projectId"`
	OwnerID        primitive.ObjectID `json:"-" bson:"ownerId,omitempty"`
	ContactData    `bson:"profile"`
	Odoo           *OdooContactSource `json:"odoo,omitempty" bson:"odoo,omitempty"`
	Version        int64              `json:"version" bson:"version"`
	CreatedAt      time.Time          `json:"createdAt" bson:"createdAt"`
	UpdatedAt      time.Time          `json:"updatedAt" bson:"updatedAt"`
}

func (c *Contact) normalize() {
	if c.OrganisationID.IsZero() {
		c.OrganisationID = c.OwnerID
	}
	if c.ProjectID.IsZero() {
		c.ProjectID = c.OwnerID
	}
}

func (d *ContactData) validate() error {
	fields := []struct {
		value *string
		label string
		max   int
	}{
		{&d.Name, "name", 200}, {&d.CompanyName, "company name", 200}, {&d.Email, "email", 320},
		{&d.Phone, "phone", 80}, {&d.Mobile, "mobile", 80}, {&d.Website, "website", 500},
		{&d.VAT, "VAT", 80}, {&d.Reference, "reference", 100},
		{&d.Address.Street, "street", 300}, {&d.Address.Street2, "street 2", 300},
		{&d.Address.PostalCode, "postal code", 40}, {&d.Address.City, "city", 150},
		{&d.Address.State, "state", 150}, {&d.Address.Country, "country", 150},
	}
	for _, field := range fields {
		*field.value = strings.TrimSpace(*field.value)
		if !utf8.ValidString(*field.value) || utf8.RuneCountInString(*field.value) > field.max || strings.ContainsRune(*field.value, 0) {
			return invalid(fmt.Sprintf("contact %s must contain at most %d valid characters", field.label, field.max))
		}
	}
	if d.Name == "" {
		return invalid("contact name is required")
	}
	if d.Email != "" {
		address, err := mail.ParseAddress(d.Email)
		if err != nil || address.Address != d.Email {
			return invalid("contact email must be a single valid email address")
		}
	}
	if d.Website != "" {
		if !strings.Contains(d.Website, "://") {
			d.Website = "https://" + d.Website
		}
		website, err := url.Parse(d.Website)
		if err != nil || website.Hostname() == "" || website.User != nil || (website.Scheme != "https" && website.Scheme != "http") {
			return invalid("contact website must be an HTTP(S) URL")
		}
	}
	if d.Type == "" {
		d.Type = "contact"
	}
	switch d.Type {
	case "contact", "invoice", "delivery", "other", "private":
	default:
		return invalid("unsupported contact address type")
	}
	if len(d.Tags) > 50 {
		return invalid("contact may have at most 50 tags")
	}
	tags := []string{}
	seen := map[string]bool{}
	for _, tag := range d.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || !utf8.ValidString(tag) || utf8.RuneCountInString(tag) > 80 {
			return invalid("contact tags must contain 1 to 80 characters")
		}
		if !seen[tag] {
			tags = append(tags, tag)
			seen[tag] = true
		}
	}
	d.Tags = tags
	return nil
}

func newContact(data ContactData, company primitive.ObjectID) (Contact, error) {
	if err := data.validate(); err != nil {
		return Contact{}, err
	}
	now := time.Now().UTC()
	return Contact{ID: primitive.NewObjectID(), OrganisationID: company, ProjectID: company, ContactData: data, Version: 1, CreatedAt: now, UpdatedAt: now}, nil
}

type ContactStore interface {
	List(context.Context) ([]Contact, error)
	Get(context.Context, primitive.ObjectID) (Contact, error)
	ByOdoo(context.Context, OdooContactSource) (Contact, error)
	Create(context.Context, Contact) error
	Save(context.Context, Contact, int64) error
}

type MongoContacts struct{ store *MongoStore }

func NewMongoContacts(ctx context.Context, store *MongoStore) (*MongoContacts, error) {
	indexer, ok := store.Client.(database.IndexManager)
	if !ok {
		return nil, fmt.Errorf("MongoDB client does not support contact indexes")
	}
	_, err := indexer.CreateIndexes(ctx, store.Name, "contacts", []mongo.IndexModel{
		{Keys: bson.D{{Key: "organisationId", Value: 1}, {Key: "projectId", Value: 1}, {Key: "profile.name", Value: 1}}},
		{Keys: bson.D{{Key: "organisationId", Value: 1}, {Key: "projectId", Value: 1}, {Key: "odoo.origin", Value: 1}, {Key: "odoo.database", Value: 1}, {Key: "odoo.id", Value: 1}},
			Options: options.Index().SetUnique(true).SetPartialFilterExpression(bson.M{
				"organisationId": bson.M{"$type": "objectId", "$gt": primitive.NilObjectID},
				"projectId":      bson.M{"$type": "objectId", "$gt": primitive.NilObjectID},
				"odoo.id":        bson.M{"$gt": 0},
			})},
	})
	if err != nil {
		return nil, fmt.Errorf("create contact indexes: %w", err)
	}
	return &MongoContacts{store}, nil
}

func (s *MongoContacts) filter(extra bson.M) bson.M {
	return bson.M{"$and": bson.A{ScopeFilter(s.store.Company), extra}}
}

func (s *MongoContacts) List(ctx context.Context) ([]Contact, error) {
	items := []Contact{}
	err := s.store.Client.Find(ctx, s.store.Name, "contacts", ScopeFilter(s.store.Company), options.Find().SetSort(bson.D{{Key: "profile.name", Value: 1}, {Key: "_id", Value: 1}})).All(&items)
	for i := range items {
		items[i].normalize()
	}
	return items, err
}

func (s *MongoContacts) find(ctx context.Context, filter bson.M) (Contact, error) {
	var item Contact
	err := s.store.Client.FindOne(ctx, s.store.Name, "contacts", s.filter(filter)).Into(&item)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Contact{}, ErrNotFound
	}
	item.normalize()
	return item, err
}

func (s *MongoContacts) Get(ctx context.Context, id primitive.ObjectID) (Contact, error) {
	return s.find(ctx, bson.M{"_id": id})
}

func (s *MongoContacts) ByOdoo(ctx context.Context, source OdooContactSource) (Contact, error) {
	return s.find(ctx, bson.M{"odoo.origin": source.Origin, "odoo.database": source.Database, "odoo.id": source.ID})
}

func (s *MongoContacts) Create(ctx context.Context, item Contact) error {
	item.normalize()
	if item.OrganisationID != s.store.Company || item.ProjectID != s.store.Company {
		return ErrNotFound
	}
	_, err := s.store.Client.InsertOne(ctx, s.store.Name, "contacts", item)
	return err
}

func (s *MongoContacts) Save(ctx context.Context, item Contact, version int64) error {
	item.normalize()
	if item.OrganisationID != s.store.Company || item.ProjectID != s.store.Company {
		return ErrNotFound
	}
	filter := s.filter(bson.M{"_id": item.ID, "version": version})
	result, err := s.store.Client.UpdateOne(ctx, s.store.Name, "contacts", filter, bson.M{"$set": bson.M{
		"profile": item.ContactData, "organisationId": item.OrganisationID, "projectId": item.ProjectID,
		"version": version + 1, "updatedAt": time.Now().UTC(),
	}})
	if err != nil {
		return err
	}
	if result.MatchedCount() == 0 {
		return ErrConflict
	}
	return nil
}

type MemoryContacts struct {
	mu      sync.Mutex
	company primitive.ObjectID
	items   map[primitive.ObjectID]Contact
}

func NewMemoryContacts(company primitive.ObjectID) *MemoryContacts {
	return &MemoryContacts{company: company, items: map[primitive.ObjectID]Contact{}}
}

func cloneContact(item Contact) Contact {
	item.Tags = append([]string{}, item.Tags...)
	if item.Odoo != nil {
		copy := *item.Odoo
		item.Odoo = &copy
	}
	return item
}
func (s *MemoryContacts) List(context.Context) ([]Contact, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := []Contact{}
	for _, item := range s.items {
		items = append(items, cloneContact(item))
	}
	return items, nil
}
func (s *MemoryContacts) Get(_ context.Context, id primitive.ObjectID) (Contact, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	if !ok {
		return Contact{}, ErrNotFound
	}
	return cloneContact(item), nil
}
func (s *MemoryContacts) ByOdoo(_ context.Context, source OdooContactSource) (Contact, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, item := range s.items {
		if item.Odoo != nil && item.Odoo.Origin == source.Origin && item.Odoo.Database == source.Database && item.Odoo.ID == source.ID {
			return cloneContact(item), nil
		}
	}
	return Contact{}, ErrNotFound
}
func (s *MemoryContacts) Create(_ context.Context, item Contact) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	item.normalize()
	if item.OrganisationID != s.company || item.ProjectID != s.company {
		return ErrNotFound
	}
	if _, ok := s.items[item.ID]; ok {
		return ErrConflict
	}
	for _, old := range s.items {
		if item.Odoo != nil && old.Odoo != nil && item.Odoo.Origin == old.Odoo.Origin && item.Odoo.Database == old.Odoo.Database && item.Odoo.ID == old.Odoo.ID {
			return ErrConflict
		}
	}
	s.items[item.ID] = cloneContact(item)
	return nil
}
func (s *MemoryContacts) Save(_ context.Context, item Contact, version int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	item.normalize()
	if item.OrganisationID != s.company || item.ProjectID != s.company {
		return ErrNotFound
	}
	old, ok := s.items[item.ID]
	if !ok {
		return ErrNotFound
	}
	if old.Version != version {
		return ErrConflict
	}
	item.Odoo, item.CreatedAt, item.Version, item.UpdatedAt = old.Odoo, old.CreatedAt, version+1, time.Now().UTC()
	s.items[item.ID] = cloneContact(item)
	return nil
}
