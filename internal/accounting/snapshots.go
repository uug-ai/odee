package accounting

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type PartnerSnapshot struct {
	ContactID     primitive.ObjectID `json:"contactId,omitempty" bson:"contactId,omitempty"`
	SourceVersion int64              `json:"sourceVersion" bson:"sourceVersion"`
	SchemaVersion int                `json:"schemaVersion" bson:"schemaVersion"`
	Data          ContactData        `json:"data" bson:"data"`
}
type CompanySnapshot struct {
	ProfileID     primitive.ObjectID `json:"profileId" bson:"profileId"`
	SourceVersion int64              `json:"sourceVersion" bson:"sourceVersion"`
	SchemaVersion int                `json:"schemaVersion" bson:"schemaVersion"`
	Role          string             `json:"role" bson:"role"`
	Data          ContactData        `json:"data" bson:"data"`
}

type draftRequest struct {
	Draft
	PartnerAction          string `json:"partnerAction"`
	ContactID              string `json:"contactId"`
	ExpectedContactVersion int64  `json:"expectedContactVersion"`
	OwnCompanyAction       string `json:"ownCompanyAction"`
	ExpectedCompanyVersion int64  `json:"expectedCompanyVersion"`
}

func (s *Server) captureCompany(ctx context.Context, doc *Document, expected int64) error {
	if s.Profiles == nil {
		if expected != 0 {
			return ErrNotFound
		}
		return nil
	}
	p, err := s.Profiles.Get(ctx)
	if errors.Is(err, ErrNotFound) && expected == 0 {
		return nil
	}
	if err != nil {
		return err
	}
	p.normalize()
	if p.OrganisationID != s.Company || p.ProjectID != s.Company {
		return ErrNotFound
	}
	if expected != 0 && p.Version != expected {
		return ErrConflict
	}
	role := "seller"
	if doc.Kind == "bill" {
		role = "buyer"
	}
	doc.OwnCompanySnapshot = &CompanySnapshot{p.ID, p.Version, 1, role, cloneData(p.Data)}
	return nil
}

func (s *Server) applyPartner(ctx context.Context, doc *Document, input *draftRequest) error {
	if doc.Status != "draft" {
		return invalid("posted documents are immutable")
	}
	switch input.PartnerAction {
	case "":
		if input.ContactID != "" || input.ExpectedContactVersion != 0 {
			return invalid("explicit contact selection or refresh is required")
		}
		if doc.PartnerSnapshot != nil && !doc.PartnerSnapshot.ContactID.IsZero() &&
			(strings.TrimSpace(input.Partner) != doc.Partner || strings.TrimSpace(input.Email) != doc.Email) {
			return invalid("convert the saved contact to manual entry before editing captured fields")
		}
		if doc.PartnerSnapshot != nil && doc.PartnerSnapshot.ContactID.IsZero() {
			doc.PartnerSnapshot.Data.Name, doc.PartnerSnapshot.Data.Email = strings.TrimSpace(input.Partner), strings.TrimSpace(input.Email)
		}
	case "manual":
		if input.ContactID != "" || input.ExpectedContactVersion != 0 {
			return invalid("manual conversion cannot include a saved contact selection")
		}
		if doc.PartnerSnapshot != nil {
			copy := *doc.PartnerSnapshot
			copy.Data = cloneData(copy.Data)
			copy.ContactID, copy.SourceVersion = primitive.NilObjectID, 0
			copy.Data.Name, copy.Data.Email = strings.TrimSpace(input.Partner), strings.TrimSpace(input.Email)
			doc.PartnerSnapshot = &copy
		}
	case "select", "refresh":
		id, err := primitive.ObjectIDFromHex(input.ContactID)
		if err != nil || id.IsZero() || input.ExpectedContactVersion < 1 {
			return invalid("contactId and expectedContactVersion are required for saved contact selection")
		}
		if input.PartnerAction == "refresh" && (doc.PartnerSnapshot == nil || doc.PartnerSnapshot.ContactID != id) {
			return invalid("refresh must select the captured contact")
		}
		if s.Contacts == nil {
			return ErrNotFound
		}
		contact, err := s.Contacts.Get(ctx, id)
		if err != nil {
			return err
		}
		contact.normalize()
		if contact.OrganisationID != s.Company || contact.ProjectID != s.Company {
			return ErrNotFound
		}
		if contact.Version != input.ExpectedContactVersion {
			return ErrConflict
		}
		if !contact.Active {
			return invalid("archived contacts cannot be selected or refreshed")
		}
		data := cloneData(contact.ContactData)
		checked := cloneData(data)
		if err := checked.validate(); err != nil {
			return err
		}
		if err := data.validateAccounting(&contact.ContactData); err != nil {
			return err
		}
		doc.PartnerSnapshot = &PartnerSnapshot{id, contact.Version, 1, data}
		input.Partner, input.Email = data.Name, data.Email
	default:
		return invalid("unsupported partner action")
	}
	return nil
}

func (s *Server) newDraft(ctx context.Context, input draftRequest) (Document, error) {
	doc := Document{Status: "draft"}
	if input.OwnCompanyAction != "" || input.ExpectedCompanyVersion != 0 {
		return doc, invalid("own company refresh is only available for existing drafts")
	}
	if err := s.applyPartner(ctx, &doc, &input); err != nil {
		return Document{}, err
	}
	captured := doc.PartnerSnapshot
	binding := Document{OrganisationID: s.Company, ProjectID: s.Company, Kind: input.Kind}
	if err := bindNewConfiguration(ctx, s.Store, &binding); err != nil {
		return Document{}, err
	}
	doc, err := NewDocument(input.Draft, s.Company, *binding.ConfigurationSelection)
	if err != nil {
		return doc, err
	}
	doc.PartnerSnapshot = captured
	doc.JournalCode = binding.JournalCode
	err = s.captureCompany(ctx, &doc, 0)
	return doc, err
}

func (s *Server) getCompany(w http.ResponseWriter, r *http.Request) {
	if s.Profiles == nil {
		reply(w, 200, nil)
		return
	}
	p, err := s.Profiles.Get(r.Context())
	if errors.Is(err, ErrNotFound) {
		reply(w, 200, nil)
	} else if err != nil {
		apiError(w, err)
	} else {
		reply(w, 200, p)
	}
}

func (s *Server) saveCompany(w http.ResponseWriter, r *http.Request) {
	if s.Profiles == nil {
		reply(w, 503, map[string]string{"error": "Company profile storage is not configured."})
		return
	}
	var input struct {
		Version int64       `json:"version"`
		Data    ContactData `json:"data"`
	}
	if !decode(w, r, &input) {
		return
	}
	p, err := s.Profiles.Get(r.Context())
	var previous *ContactData
	if errors.Is(err, ErrNotFound) && input.Version == 0 {
		p = CompanyProfile{ID: s.Company, OrganisationID: s.Company, ProjectID: s.Company}
	} else if err != nil {
		apiError(w, err)
		return
	} else {
		previous = &p.Data
	}
	if input.Version < 0 || p.Version != input.Version {
		apiError(w, ErrConflict)
		return
	}
	if err = input.Data.validate(); err == nil {
		err = input.Data.validateAccounting(previous)
	}
	if err == nil {
		p.Data = input.Data
		err = s.Profiles.Save(r.Context(), p, input.Version)
	}
	if err != nil {
		apiError(w, err)
		return
	}
	p.Version, p.UpdatedAt = input.Version+1, time.Now().UTC()
	reply(w, 200, p)
}
