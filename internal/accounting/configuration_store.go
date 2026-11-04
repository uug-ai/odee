package accounting

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type ConfigurationStore interface {
	Head(context.Context) (ConfigurationHead, error)
	SaveStage(context.Context, ConfigurationStage, int64) error
	Published(context.Context, primitive.ObjectID) (PublishedConfiguration, error)
	InsertPublished(context.Context, PublishedConfiguration) error
	Reassert(context.Context, PublishedConfiguration) error
	Versions(context.Context, *PublishedConfiguration) ([]PublishedConfiguration, error)
	Activate(context.Context, PublishedConfiguration, int64) error
}
type mongoConfiguration struct {
	store   *MongoStore
	company primitive.ObjectID
}

func (s *MongoStore) Configuration(company primitive.ObjectID) ConfigurationStore {
	return &mongoConfiguration{s, company}
}
func (m *mongoConfiguration) filter(extra bson.M) bson.M {
	return bson.M{"$and": bson.A{ScopeFilter(m.company), extra}}
}
func (m *mongoConfiguration) Head(ctx context.Context) (ConfigurationHead, error) {
	var head ConfigurationHead
	if m.company != m.store.Company {
		return head, ErrNotFound
	}
	err := m.store.Client.FindOne(ctx, m.store.Name, "accounting_configuration", m.filter(bson.M{"_id": m.company})).Into(&head)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return head, ErrNotFound
	}
	if err == nil && (!scopeIDs(head.OrganisationID, head.ProjectID, head.OwnerID, m.company) || head.SchemaVersion != 1) {
		return head, invalid("configuration head integrity check failed")
	}
	return head, err
}
func (m *mongoConfiguration) SaveStage(ctx context.Context, stage ConfigurationStage, expected int64) error {
	if m.company != m.store.Company {
		return ErrNotFound
	}
	if expected == 0 {
		head := ConfigurationHead{ID: m.company, OrganisationID: m.company, ProjectID: m.company, SchemaVersion: 1, Stage: stage}
		_, err := m.store.Client.InsertOne(ctx, m.store.Name, "accounting_configuration", head)
		if mongo.IsDuplicateKeyError(err) {
			return ErrConflict
		}
		if err != nil {
			return fmt.Errorf("%w: %w", ErrUncertain, err)
		}
		return nil
	}
	result, err := m.store.Client.UpdateOne(ctx, m.store.Name, "accounting_configuration", m.filter(bson.M{"_id": m.company, "stage.version": expected}),
		bson.M{"$set": bson.M{"stage": stage, "organisationId": m.company, "projectId": m.company}})
	if err != nil {
		return fmt.Errorf("%w: %w", ErrUncertain, err)
	}
	if result.MatchedCount() != 1 {
		return ErrConflict
	}
	return nil
}
func (m *mongoConfiguration) Published(ctx context.Context, id primitive.ObjectID) (PublishedConfiguration, error) {
	var p PublishedConfiguration
	if m.company != m.store.Company {
		return p, ErrNotFound
	}
	err := m.store.Client.FindOne(ctx, m.store.Name, "accounting_configuration_versions", m.filter(bson.M{"_id": id})).Into(&p)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return p, ErrNotFound
	}
	if err != nil {
		return p, err
	}
	if err := p.validate(m.company); err != nil {
		return p, err
	}
	p.normalizeOwnership()
	return p, nil
}
func (m *mongoConfiguration) InsertPublished(ctx context.Context, p PublishedConfiguration) error {
	if err := p.validate(m.company); err != nil {
		return err
	}
	if m.company != m.store.Company {
		return ErrNotFound
	}
	_, err := m.store.Client.InsertOne(ctx, m.store.Name, "accounting_configuration_versions", p)
	if mongo.IsDuplicateKeyError(err) {
		return ErrConflict
	}
	if err != nil {
		return fmt.Errorf("%w: %w", ErrUncertain, err)
	}
	return nil
}
func (m *mongoConfiguration) Reassert(ctx context.Context, p PublishedConfiguration) error {
	if err := p.validate(m.company); err != nil {
		return err
	}
	if m.company != m.store.Company {
		return ErrNotFound
	}
	nonce := primitive.NewObjectID()
	for nonce == p.DurabilityNonce {
		nonce = primitive.NewObjectID()
	}
	filter := m.filter(bson.M{"_id": p.ID, "payload.schemaVersion": p.Payload.SchemaVersion, "payload.sourceStageId": p.Payload.SourceStageID,
		"payload.sourceStageVersion": p.Payload.SourceStageVersion, "payload.publishedAt": p.Payload.PublishedAt, "payload.digest": p.Payload.Digest})
	result, err := m.store.Client.UpdateOne(ctx, m.store.Name, "accounting_configuration_versions", filter, bson.M{"$set": bson.M{"_durabilityNonce": nonce}}, options.Update().SetUpsert(false))
	if err != nil {
		return fmt.Errorf("%w: %w", ErrUncertain, err)
	}
	if result.MatchedCount() != 1 {
		return ErrConflict
	}
	if result.ModifiedCount() != 1 || result.UpsertedCount() != 0 {
		return ErrUncertain
	}
	verified, err := m.Published(ctx, p.ID)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(verified.Payload, p.Payload) {
		return invalid("published configuration integrity check failed")
	}
	return nil
}
func (m *mongoConfiguration) Activate(ctx context.Context, p PublishedConfiguration, expected int64) error {
	if expected < 0 {
		return ErrConflict
	}
	head, err := m.Head(ctx)
	if err != nil {
		return err
	}
	if head.Default.Revision != expected {
		return ErrConflict
	}
	if len(p.Payload.Data.readiness("invoice")) > 0 || len(p.Payload.Data.readiness("bill")) > 0 {
		return invalid("configuration is not ready for activation")
	}
	if err = m.Reassert(ctx, p); err != nil {
		return err
	}
	result, err := m.store.Client.UpdateOne(ctx, m.store.Name, "accounting_configuration", m.filter(bson.M{"_id": m.company, "default.revision": expected}),
		bson.M{"$set": bson.M{"default": ConfigurationDefault{expected + 1, &p.ID}, "organisationId": m.company, "projectId": m.company}})
	if err != nil {
		return fmt.Errorf("%w: %w", ErrUncertain, err)
	}
	if result.MatchedCount() != 1 {
		return ErrConflict
	}
	return nil
}
func olderVersion(a, b PublishedConfiguration) bool {
	if a.Payload.PublishedAt.Equal(b.Payload.PublishedAt) {
		return a.ID.Hex() < b.ID.Hex()
	}
	return a.Payload.PublishedAt.Before(b.Payload.PublishedAt)
}
func (m *mongoConfiguration) Versions(ctx context.Context, after *PublishedConfiguration) ([]PublishedConfiguration, error) {
	if m.company != m.store.Company {
		return nil, ErrNotFound
	}
	filter := bson.M{}
	if after != nil {
		filter["$or"] = bson.A{bson.M{"payload.publishedAt": bson.M{"$lt": after.Payload.PublishedAt}}, bson.M{"payload.publishedAt": after.Payload.PublishedAt, "_id": bson.M{"$lt": after.ID}}}
	}
	result := []PublishedConfiguration{}
	err := m.store.Client.Find(ctx, m.store.Name, "accounting_configuration_versions", m.filter(filter), options.Find().SetSort(bson.D{{Key: "payload.publishedAt", Value: -1}, {Key: "_id", Value: -1}}).SetLimit(51)).All(&result)
	if err != nil {
		return nil, err
	}
	for i, p := range result {
		if err = p.validate(m.company); err != nil {
			return nil, err
		}
		result[i].normalizeOwnership()
	}
	return result, nil
}

type memoryConfiguration struct {
	store   *MemoryStore
	company primitive.ObjectID
}

func (s *MemoryStore) Configuration(company primitive.ObjectID) ConfigurationStore {
	return &memoryConfiguration{s, company}
}
func (m *memoryConfiguration) Head(context.Context) (ConfigurationHead, error) {
	m.store.mu.Lock()
	defer m.store.mu.Unlock()
	head, ok := m.store.configurationHeads[m.company]
	if !ok || !scopeIDs(head.OrganisationID, head.ProjectID, head.OwnerID, m.company) {
		return ConfigurationHead{}, ErrNotFound
	}
	if head.SchemaVersion != 1 {
		return head, invalid("configuration head integrity check failed")
	}
	return copyConfiguration(head), nil
}
func (m *memoryConfiguration) SaveStage(_ context.Context, stage ConfigurationStage, expected int64) error {
	m.store.mu.Lock()
	defer m.store.mu.Unlock()
	if m.store.configurationHeads == nil {
		m.store.configurationHeads = map[primitive.ObjectID]ConfigurationHead{}
	}
	head, exists := m.store.configurationHeads[m.company]
	if (!exists && expected != 0) || (exists && (expected == 0 || !scopeIDs(head.OrganisationID, head.ProjectID, head.OwnerID, m.company) || head.Stage.Version != expected)) {
		return ErrConflict
	}
	if !exists {
		head = ConfigurationHead{ID: m.company, OrganisationID: m.company, ProjectID: m.company, SchemaVersion: 1}
	}
	head.Stage = copyConfiguration(stage)
	head.OrganisationID = m.company
	head.ProjectID = m.company
	m.store.configurationHeads[m.company] = head
	return nil
}
func (m *memoryConfiguration) Published(_ context.Context, id primitive.ObjectID) (PublishedConfiguration, error) {
	m.store.mu.Lock()
	defer m.store.mu.Unlock()
	p, ok := m.store.configurationVersions[id]
	if !ok {
		return p, ErrNotFound
	}
	if err := p.validate(m.company); err != nil {
		return p, err
	}
	p.normalizeOwnership()
	return copyConfiguration(p), nil
}
func (m *memoryConfiguration) InsertPublished(_ context.Context, p PublishedConfiguration) error {
	if err := p.validate(m.company); err != nil {
		return err
	}
	m.store.mu.Lock()
	defer m.store.mu.Unlock()
	if m.store.configurationVersions == nil {
		m.store.configurationVersions = map[primitive.ObjectID]PublishedConfiguration{}
	}
	if _, ok := m.store.configurationVersions[p.ID]; ok {
		return ErrConflict
	}
	m.store.configurationVersions[p.ID] = copyConfiguration(p)
	return nil
}
func (m *memoryConfiguration) Reassert(ctx context.Context, p PublishedConfiguration) error {
	verified, err := m.Published(ctx, p.ID)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(verified.Payload, p.Payload) {
		return ErrConflict
	}
	m.store.mu.Lock()
	defer m.store.mu.Unlock()
	current := m.store.configurationVersions[p.ID]
	current.DurabilityNonce = primitive.NewObjectID()
	m.store.configurationVersions[p.ID] = current
	return nil
}
func (m *memoryConfiguration) Activate(ctx context.Context, p PublishedConfiguration, expected int64) error {
	if expected < 0 {
		return ErrConflict
	}
	head, err := m.Head(ctx)
	if err != nil {
		return err
	}
	if head.Default.Revision != expected {
		return ErrConflict
	}
	if len(p.Payload.Data.readiness("invoice")) > 0 || len(p.Payload.Data.readiness("bill")) > 0 {
		return invalid("configuration is not ready for activation")
	}
	if err := m.Reassert(ctx, p); err != nil {
		return err
	}
	m.store.mu.Lock()
	defer m.store.mu.Unlock()
	head, ok := m.store.configurationHeads[m.company]
	if !ok || !scopeIDs(head.OrganisationID, head.ProjectID, head.OwnerID, m.company) || head.Default.Revision != expected {
		return ErrConflict
	}
	head.Default = ConfigurationDefault{expected + 1, &p.ID}
	head.OrganisationID = m.company
	head.ProjectID = m.company
	m.store.configurationHeads[m.company] = copyConfiguration(head)
	return nil
}
func (m *memoryConfiguration) Versions(_ context.Context, after *PublishedConfiguration) ([]PublishedConfiguration, error) {
	m.store.mu.Lock()
	defer m.store.mu.Unlock()
	result := []PublishedConfiguration{}
	for _, p := range m.store.configurationVersions {
		if scopeIDs(p.OrganisationID, p.ProjectID, p.OwnerID, m.company) && (after == nil || olderVersion(p, *after)) {
			if err := p.validate(m.company); err != nil {
				return nil, err
			}
			p.normalizeOwnership()
			result = append(result, copyConfiguration(p))
		}
	}
	sort.Slice(result, func(i, j int) bool { return olderVersion(result[j], result[i]) })
	if len(result) > 51 {
		result = result[:51]
	}
	return result, nil
}
func publishConfiguration(ctx context.Context, store ConfigurationStore, company primitive.ObjectID, version int64, id primitive.ObjectID) (PublishedConfiguration, error) {
	if version < 1 || id.IsZero() {
		return PublishedConfiguration{}, invalid("stage version and publication ID are required")
	}
	p, err := store.Published(ctx, id)
	if err == nil {
		if p.Payload.SourceStageVersion != version || p.Payload.SourceStageID != company {
			return p, ErrConflict
		}
		return p, store.Reassert(ctx, p)
	}
	if !errors.Is(err, ErrNotFound) {
		return p, err
	}
	head, err := store.Head(ctx)
	if err != nil {
		return p, err
	}
	if head.Stage.Version != version || head.Stage.PublicationID != id {
		return p, ErrConflict
	}
	if len(head.Stage.Data.structuralErrors()) > 0 {
		return p, invalid("configuration has structural validation errors")
	}
	p = PublishedConfiguration{ID: id, OrganisationID: company, ProjectID: company, Payload: ConfigurationPayload{1, company, version, head.Stage.Digest, time.Now().UTC().Truncate(time.Millisecond), copyConfiguration(head.Stage.Data)}}
	err = store.InsertPublished(ctx, p)
	if errors.Is(err, ErrConflict) {
		winner, readErr := store.Published(ctx, id)
		if readErr != nil {
			return p, readErr
		}
		attempt := p.Payload
		attempt.PublishedAt = winner.Payload.PublishedAt
		if !reflect.DeepEqual(attempt, winner.Payload) {
			return p, ErrConflict
		}
		return winner, store.Reassert(ctx, winner)
	}
	return p, err
}
