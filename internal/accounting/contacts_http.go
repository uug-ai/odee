package accounting

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

type OdooContactInput struct {
	ContactData
	ExternalID int64 `json:"externalId"`
	ParentID   int64 `json:"parentId"`
	CompanyID  int64 `json:"companyId"`
}

type ContactImport struct {
	Source   string             `json:"source"`
	Database string             `json:"database"`
	Contacts []OdooContactInput `json:"contacts"`
	Reviewed bool               `json:"reviewed"`
}

func (s *Server) contactsReady(w http.ResponseWriter) bool {
	if s.Contacts == nil {
		reply(w, 503, map[string]string{"error": "Contact storage is not configured."})
		return false
	}
	return true
}

func (s *Server) listContacts(w http.ResponseWriter, r *http.Request) {
	if !s.contactsReady(w) {
		return
	}
	items, err := s.Contacts.List(r.Context())
	if err != nil {
		apiError(w, err)
		return
	}
	reply(w, 200, items)
}

func (s *Server) createContact(w http.ResponseWriter, r *http.Request) {
	if !s.contactsReady(w) {
		return
	}
	var input ContactData
	if !decode(w, r, &input) {
		return
	}
	item, err := newContact(input, s.Company)
	if err == nil {
		err = s.Contacts.Create(r.Context(), item)
	}
	if err != nil {
		apiError(w, err)
		return
	}
	reply(w, 201, item)
}

func (s *Server) editContact(w http.ResponseWriter, r *http.Request) {
	if !s.contactsReady(w) {
		return
	}
	var input struct {
		ContactData
		Version int64 `json:"version"`
	}
	if !decode(w, r, &input) {
		return
	}
	id, err := primitive.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		apiError(w, invalid("invalid contact ID"))
		return
	}
	item, err := s.Contacts.Get(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return
	}
	if input.Version < 1 || item.Version != input.Version {
		apiError(w, ErrConflict)
		return
	}
	if err := input.ContactData.validate(); err != nil {
		apiError(w, err)
		return
	}
	item.ContactData = input.ContactData
	if err := s.Contacts.Save(r.Context(), item, input.Version); err != nil {
		apiError(w, err)
		return
	}
	item.Version++
	item.UpdatedAt = time.Now().UTC()
	reply(w, 200, item)
}

func (s *Server) importContacts(w http.ResponseWriter, r *http.Request) {
	if !s.contactsReady(w) {
		return
	}
	var input ContactImport
	if !decodeLimit(w, r, &input, 2*1024*1024) {
		return
	}
	origin, err := url.Parse(input.Source)
	if !input.Reviewed || err != nil || origin.Hostname() == "" || origin.Scheme != "https" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") {
		apiError(w, invalid("confirm the contact import and provide the HTTPS Odoo origin without a path"))
		return
	}
	input.Source = strings.TrimSuffix(origin.String(), "/")
	input.Database = strings.TrimSpace(input.Database)
	if input.Database == "" || len(input.Database) > 200 || !utf8.ValidString(input.Database) || strings.ContainsRune(input.Database, 0) || len(input.Contacts) < 1 || len(input.Contacts) > 1000 {
		apiError(w, invalid("provide an Odoo database identity and 1 to 1000 contacts per import"))
		return
	}
	items := make([]Contact, 0, len(input.Contacts))
	seen := map[int64]bool{}
	for row, record := range input.Contacts {
		originalWebsite := strings.TrimSpace(record.Website)
		// Browsers accept extra authority slashes; retain Odoo's text alongside the normalized URL.
		for _, scheme := range []string{"http", "https"} {
			if strings.HasPrefix(originalWebsite, scheme+":///") {
				record.Website = scheme + "://" + strings.TrimLeft(strings.TrimPrefix(originalWebsite, scheme+":"), "/")
			}
		}
		if record.ExternalID < 1 || record.ParentID < 0 || record.CompanyID < 0 || record.ParentID == record.ExternalID || seen[record.ExternalID] {
			apiError(w, invalid(fmt.Sprintf("contact row %d has an invalid or repeated Odoo ID", row+1)))
			return
		}
		item, err := newContact(record.ContactData, s.Company)
		if err != nil {
			apiError(w, invalid(fmt.Sprintf("contact row %d: %s", row+1, err)))
			return
		}
		item.Odoo = &OdooContactSource{Origin: input.Source, Database: input.Database, ID: record.ExternalID, ParentID: record.ParentID, CompanyID: record.CompanyID, ImportedAt: time.Now().UTC(), OriginalWebsite: originalWebsite}
		items = append(items, item)
		seen[record.ExternalID] = true
	}
	created, skipped, normalizedWebsites := 0, 0, 0
	for row, item := range items {
		_, err := s.Contacts.ByOdoo(r.Context(), *item.Odoo)
		if err == nil {
			skipped++
			continue
		}
		if errors.Is(err, ErrNotFound) {
			err = s.Contacts.Create(r.Context(), item)
			if mongo.IsDuplicateKeyError(err) || errors.Is(err, ErrConflict) {
				_, err = s.Contacts.ByOdoo(r.Context(), *item.Odoo)
				if err == nil {
					skipped++
					continue
				}
			}
			if err == nil {
				created++
				if item.Odoo.OriginalWebsite != "" && item.Odoo.OriginalWebsite != item.Website {
					normalizedWebsites++
				}
				continue
			}
		}
		slog.Error("contact import interrupted", "row", row+1, "created", created, "skipped", skipped, "error", err)
		reply(w, 503, map[string]any{"created": created, "skipped": skipped, "error": fmt.Sprintf("Contact storage interrupted at row %d after creating %d and skipping %d. Refresh before retrying; existing Odoo IDs will be skipped.", row+1, created, skipped)})
		return
	}
	reply(w, 200, map[string]int{"created": created, "skipped": skipped, "total": len(items), "normalizedWebsites": normalizedWebsites})
}
