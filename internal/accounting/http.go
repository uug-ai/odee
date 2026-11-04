package accounting

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Server struct {
	Store         Store
	Company       primitive.ObjectID
	Name          string
	Token         string
	Origin        string
	Demo          bool
	Dev           bool
	Auth          *GitHubAuth
	Authorization *Authorization
	Imports       ImportStore
	Scanner       *Scanner
	Contacts      ContactStore
	uploadSlots   chan struct{}
}

func (s *Server) Handler() http.Handler {
	s.uploadSlots = make(chan struct{}, 2)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", s.require(s.state, Read))
	mux.HandleFunc("GET /api/contacts", s.require(s.listContacts, Read))
	mux.HandleFunc("POST /api/contacts", s.require(s.createContact, Read, Write))
	mux.HandleFunc("PUT /api/contacts/{id}", s.require(s.editContact, Read, Write))
	mux.HandleFunc("POST /api/contacts/import", s.require(s.importContacts, Read, Write))
	mux.HandleFunc("POST /api/documents", s.require(s.create, Read, Write))
	mux.HandleFunc("PUT /api/documents/{id}", s.require(s.edit, Read, Write))
	mux.HandleFunc("POST /api/documents/{id}/post", s.require(s.post, Read, Post))
	mux.HandleFunc("POST /api/documents/{id}/payments", s.require(s.payment, Read, Post))
	mux.HandleFunc("GET /api/documents/{id}/audit", s.require(s.audit, Read, Admin))
	mux.HandleFunc("POST /api/imports", s.require(s.uploadBill, Read, Write))
	mux.HandleFunc("GET /api/imports/{id}", s.require(s.getImport, Read))
	mux.HandleFunc("GET /api/imports/{id}/original", s.require(s.original, Read))
	mux.HandleFunc("GET /api/imports/{id}/preview", s.require(s.preview, Read))
	mux.HandleFunc("POST /api/imports/{id}/scan", s.require(s.rescan, Read, Write))
	mux.HandleFunc("POST /api/imports/{id}/draft", s.require(s.importDraft, Read, Write))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if s.Auth != nil {
			if !s.Auth.Authorize(w, r) {
				return
			}
		} else if !s.Dev {
			if !s.validToken(r) {
				reply(w, http.StatusUnauthorized, map[string]string{"error": "Enter the company access token to continue."})
				return
			}
		}
		if r.Method != http.MethodGet && r.Header.Get("Origin") != s.Origin {
			reply(w, http.StatusForbidden, map[string]string{"error": "Request origin is not allowed."})
			return
		}
		if r.Method != http.MethodGet {
			media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			expected := "application/json"
			if r.URL.Path == "/api/imports" && r.Method == http.MethodPost {
				expected = "multipart/form-data"
			}
			if err != nil || media != expected {
				reply(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Use " + expected + "."})
				return
			}
		}
		timeout := 10 * time.Second
		if strings.HasPrefix(r.URL.Path, "/api/imports") {
			timeout = 180 * time.Second
		}
		if r.URL.Path == "/api/contacts/import" {
			timeout = 120 * time.Second
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		mux.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) validToken(r *http.Request) bool {
	expected := sha256.Sum256([]byte(s.Token))
	actual := sha256.Sum256([]byte(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")))
	return s.Token != "" && strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") && subtle.ConstantTimeCompare(expected[:], actual[:]) == 1
}

func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write API response", "error", err)
	}
}

func apiError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "Workspace storage is unavailable. Your change has not been confirmed; refresh before retrying."
	switch {
	case errors.Is(err, ErrInvalid):
		status, message = http.StatusUnprocessableEntity, err.Error()
	case errors.Is(err, ErrNotFound):
		status, message = http.StatusNotFound, err.Error()
	case errors.Is(err, ErrConflict):
		status, message = http.StatusConflict, err.Error()
	case errors.Is(err, ErrUncertain):
		reply(w, http.StatusServiceUnavailable, map[string]string{
			"error": ErrUncertain.Error(), "code": "reconciliation_required",
		})
		slog.Error("accounting write requires reconciliation", "error", err)
		return
	default:
		slog.Error("accounting request failed", "error", err)
	}
	reply(w, status, map[string]string{"error": message})
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	return decodeLimit(w, r, target, 128*1024)
}

func decodeLimit(w http.ResponseWriter, r *http.Request, target any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		reply(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON request: " + err.Error()})
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		reply(w, http.StatusBadRequest, map[string]string{"error": "Send exactly one JSON object."})
		return false
	}
	return true
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	docs, err := s.Store.List(r.Context())
	if err != nil {
		apiError(w, err)
		return
	}
	scoped := make([]Document, 0, len(docs))
	for _, doc := range docs {
		doc.NormalizeOwnership()
		if doc.OrganisationID == s.Company && doc.ProjectID == s.Company {
			scoped = append(scoped, doc)
		}
	}
	docs = scoped
	imports := []BillImport{}
	contacts := []Contact{}
	if s.Contacts != nil {
		contacts, err = s.Contacts.List(r.Context())
		if err != nil {
			apiError(w, err)
			return
		}
	}
	scannerReady, scannerError := false, "Local scanning is not configured."
	if s.Imports != nil {
		imports, err = s.Imports.List(r.Context())
		if err != nil {
			apiError(w, err)
			return
		}
	}
	if s.Scanner != nil {
		if err := s.Scanner.Ready(); err != nil {
			scannerError = err.Error()
		} else {
			scannerReady, scannerError = true, ""
		}
	}
	reply(w, http.StatusOK, map[string]any{
		"company": s.Name, "currency": "EUR", "demo": s.Demo, "development": s.Dev,
		"accounts": Accounts, "documents": docs,
		"contacts": contacts,
		"imports":  imports, "scannerReady": scannerReady, "scannerError": scannerError,
	})
}

func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	var input Draft
	if !decode(w, r, &input) {
		return
	}
	doc, err := NewDocument(input, s.Company)
	if err == nil {
		err = s.Store.Create(r.Context(), doc)
	}
	if err != nil {
		apiError(w, err)
		return
	}
	reply(w, http.StatusCreated, doc)
}

func (s *Server) load(w http.ResponseWriter, r *http.Request, version int64) (Document, bool) {
	id, err := primitive.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		apiError(w, invalid("invalid document ID"))
		return Document{}, false
	}
	doc, err := s.Store.Get(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return Document{}, false
	}
	doc.NormalizeOwnership()
	if doc.OrganisationID != s.Company || doc.ProjectID != s.Company {
		apiError(w, ErrNotFound)
		return Document{}, false
	}
	if version < 1 || version != doc.Version {
		apiError(w, ErrConflict)
		return Document{}, false
	}
	return doc, true
}

func (s *Server) save(w http.ResponseWriter, r *http.Request, doc Document, err error) {
	if err == nil {
		err = s.Store.Save(r.Context(), doc, doc.Version)
	}
	if err != nil {
		apiError(w, err)
		return
	}
	doc.Version++
	doc.UpdatedAt = time.Now().UTC()
	reply(w, http.StatusOK, doc)
}

func (s *Server) edit(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Version int64 `json:"version"`
		Draft
	}
	if !decode(w, r, &input) {
		return
	}
	doc, ok := s.load(w, r, input.Version)
	if ok {
		err := doc.SetDraft(input.Draft)
		s.save(w, r, doc, err)
	}
}

func (s *Server) post(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Version int64 `json:"version"`
	}
	if !decode(w, r, &input) {
		return
	}
	doc, ok := s.load(w, r, input.Version)
	if ok {
		err := doc.Post()
		if err == nil {
			err = doc.attribute(r.Context(), "document.post")
		}
		s.save(w, r, doc, err)
	}
}

func (s *Server) payment(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Version   int64  `json:"version"`
		ID        string `json:"id"`
		Date      string `json:"date"`
		Amount    int64  `json:"amount"`
		Reference string `json:"reference"`
	}
	if !decode(w, r, &input) {
		return
	}
	doc, ok := s.load(w, r, input.Version)
	if ok {
		err := doc.RecordPayment(Payment{ID: input.ID, Date: input.Date, Amount: input.Amount, Reference: input.Reference})
		if err == nil {
			err = doc.attribute(r.Context(), "manual-payment.record")
		}
		s.save(w, r, doc, err)
	}
}
