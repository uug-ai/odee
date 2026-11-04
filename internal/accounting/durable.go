package accounting

import (
	"context"
	"time"

	"github.com/uug-ai/database/pkg/database"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/writeconcern"
)

// Keep the existing injectable database boundary while journal-acknowledging
// the bounded accounting collections; the shared client's pool is unchanged.
type durableDatabase struct {
	database.DatabaseInterface
	native *database.MongoClient
}

func nativeDatabase(client database.DatabaseInterface) (*database.MongoClient, bool) {
	switch c := client.(type) {
	case *database.MongoClient:
		return c, true
	case *durableDatabase:
		return c.native, true
	default:
		return nil, false
	}
}
func (d *durableDatabase) collection(name, collection string) *mongo.Collection {
	return d.native.Client.Database(name).Collection(collection, options.Collection().SetWriteConcern(writeconcern.New(writeconcern.WMajority(), writeconcern.J(true), writeconcern.WTimeout(5*time.Second))))
}
func financialCollection(collection string) bool {
	return collection == "accounting_documents" || collection == "accounting_configuration" || collection == "accounting_configuration_versions"
}
func (d *durableDatabase) InsertOne(ctx context.Context, name, collection string, doc any, opts ...any) (any, error) {
	if !financialCollection(collection) {
		return d.DatabaseInterface.InsertOne(ctx, name, collection, doc, opts...)
	}
	result, err := d.collection(name, collection).InsertOne(ctx, doc)
	return result, err
}

type durableResult struct{ result *mongo.UpdateResult }

func (r durableResult) MatchedCount() int64  { return r.result.MatchedCount }
func (r durableResult) ModifiedCount() int64 { return r.result.ModifiedCount }
func (r durableResult) UpsertedCount() int64 { return r.result.UpsertedCount }
func (r durableResult) UpsertedID() any      { return r.result.UpsertedID }
func (d *durableDatabase) UpdateOne(ctx context.Context, name, collection string, filter, update any, opts ...any) (database.UpdateResultInterface, error) {
	if !financialCollection(collection) {
		return d.DatabaseInterface.UpdateOne(ctx, name, collection, filter, update, opts...)
	}
	updateOpts := []*options.UpdateOptions{}
	for _, opt := range opts {
		if value, ok := opt.(*options.UpdateOptions); ok {
			updateOpts = append(updateOpts, value)
		}
	}
	result, err := d.collection(name, collection).UpdateOne(ctx, filter, update, updateOpts...)
	if err != nil {
		return nil, err
	}
	return durableResult{result}, nil
}
func (d *durableDatabase) CreateIndexes(ctx context.Context, name, collection string, indexes []mongo.IndexModel, opts ...any) ([]string, error) {
	return d.native.CreateIndexes(ctx, name, collection, indexes, opts...)
}
