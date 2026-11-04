package accounting

import (
	"context"
	"fmt"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestReviewRetryRejectsForeignCanonicalDocument(t *testing.T) {
	for _, persistent := range []bool{false, true} {
		t.Run(fmt.Sprint(persistent), func(t *testing.T) {
			s := snapshotServer(t, persistent)
			ctx := context.Background()
			if persistent {
				var err error
				s.Imports, err = NewMongoImports(ctx, s.Store.(*MongoStore))
				if err != nil {
					t.Fatal(err)
				}
			} else {
				s.Imports = NewMemoryImports(s.Company)
			}
			original := []byte("synthetic original")
			item := importMetadata(s.Company, original)
			item.Status = "failed"
			if err := s.Imports.Upload(ctx, item, original); err != nil {
				t.Fatal(err)
			}
			doc, _ := NewDocument(draft("bill"), s.Company)
			doc.ID, doc.SourceID, doc.OwnerID = item.ID, &item.ID, s.Company
			doc.OrganisationID = primitive.NewObjectID()
			if persistent {
				store := s.Store.(*MongoStore)
				if _, err := store.Client.InsertOne(ctx, store.Name, "accounting_documents", doc); err != nil {
					t.Fatal(err)
				}
			} else {
				s.Store.(*MemoryStore).docs[doc.ID] = doc
			}
			snapshotCall(t, s, "POST", "imports/"+item.ID.Hex()+"/draft", struct {
				Draft
				Reviewed bool `json:"reviewed"`
			}{draft("bill"), true}, 404, nil)
			unchanged, _ := s.Imports.Get(ctx, item.ID)
			if unchanged.Version != item.Version || unchanged.DocumentID != nil {
				t.Fatal("foreign retry modified import")
			}
		})
	}
}
