package accounting

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

func (s *Server) importID(w http.ResponseWriter, r *http.Request) (primitive.ObjectID, bool) {
	if s.Imports == nil {
		reply(w, 503, map[string]string{"error": "Original document storage is not configured."})
		return primitive.NilObjectID, false
	}
	id, err := primitive.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		apiError(w, invalid("invalid import ID"))
		return id, false
	}
	return id, true
}

func (s *Server) uploadBill(w http.ResponseWriter, r *http.Request) {
	select {
	case s.uploadSlots <- struct{}{}:
		defer func() { <-s.uploadSlots }()
	default:
		reply(w, 429, map[string]string{"error": "Two bills are already processing. Wait for them to finish before retrying."})
		return
	}
	if s.Imports == nil {
		reply(w, 503, map[string]string{"error": "Original document storage is not configured."})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxFileBytes+1024*1024)
	reader, err := r.MultipartReader()
	if err != nil {
		reply(w, 400, map[string]string{"error": "Invalid multipart upload."})
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" || part.FileName() == "" {
		reply(w, 400, map[string]string{"error": "Upload one file in the file field."})
		return
	}
	data, err := io.ReadAll(io.LimitReader(part, MaxFileBytes+1))
	if err != nil {
		reply(w, 400, map[string]string{"error": "Could not read the uploaded file."})
		return
	}
	if len(data) > MaxFileBytes {
		reply(w, 413, map[string]string{"error": "Each bill may be at most 20 MiB."})
		return
	}
	if _, err := reader.NextPart(); err != io.EOF {
		reply(w, 400, map[string]string{"error": "Upload exactly one file per request."})
		return
	}
	contentType, err := fileType(data)
	if err != nil {
		apiError(w, err)
		return
	}
	hash := sha256.Sum256(data)
	hashString := hex.EncodeToString(hash[:])
	if existing, err := s.Imports.ByHash(r.Context(), hashString); err == nil {
		reply(w, 200, map[string]any{"import": existing, "duplicate": true})
		return
	} else if !errors.Is(err, ErrNotFound) {
		apiError(w, err)
		return
	}
	filename := filepath.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
	filename = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, filename)
	if filename == "" || len([]rune(filename)) > 200 {
		apiError(w, invalid("filename must contain 1 to 200 characters"))
		return
	}
	now := time.Now().UTC()
	item := BillImport{ID: primitive.NewObjectID(), OrganisationID: s.Company, ProjectID: s.Company,
		Filename: filename, ContentType: contentType, SHA256: hashString, Size: int64(len(data)),
		Status: "pending", Version: 1, Scan: emptyScan(), CreatedAt: now, UpdatedAt: now}
	if err := s.Imports.Upload(r.Context(), item, data); err != nil {
		if mongo.IsDuplicateKeyError(err) || errors.Is(err, ErrConflict) {
			existing, findErr := s.Imports.ByHash(r.Context(), hashString)
			if findErr != nil {
				apiError(w, findErr)
				return
			}
			reply(w, 200, map[string]any{"import": existing, "duplicate": true})
			return
		}
		apiError(w, err)
		return
	}
	item, err = s.scanImport(r, item, data)
	if err != nil {
		apiError(w, err)
		return
	}
	reply(w, 201, map[string]any{"import": item, "duplicate": false})
}

func (s *Server) scanImport(r *http.Request, item BillImport, data []byte) (BillImport, error) {
	if item.DocumentID != nil {
		return item, invalid("converted imports keep their original scan")
	}
	if item.Status == "scanning" && time.Since(item.UpdatedAt) < 3*time.Minute {
		return item, ErrConflict
	}
	item.Status, item.Error = "scanning", ""
	if err := s.Imports.Save(r.Context(), item, item.Version); err != nil {
		return item, err
	}
	item.Version++
	scan, scanErr := emptyScan(), fmt.Errorf("local scanning is not configured")
	if s.Scanner != nil {
		scan, scanErr = s.Scanner.Scan(r.Context(), data, item.ContentType)
	}
	item.Scan, item.Status = scan, "ready"
	if scanErr != nil {
		item.Status, item.Error = "failed", scanErr.Error()
		item.Scan.Warnings = append(item.Scan.Warnings, "Scanning failed. The original is preserved; complete a draft manually or retry scanning.")
		slog.Warn("bill scan failed", "import", item.ID.Hex(), "error", scanErr)
	} else {
		docs, err := s.Store.List(r.Context())
		if err != nil {
			return item, err
		}
		for _, doc := range docs {
			if doc.Kind == "bill" && scan.Draft.Reference != "" && strings.EqualFold(strings.TrimSpace(doc.Reference), strings.TrimSpace(scan.Draft.Reference)) && strings.EqualFold(strings.TrimSpace(doc.Partner), strings.TrimSpace(scan.Draft.Partner)) {
				item.Scan.Warnings = append(item.Scan.Warnings, "Possible duplicate: a bill with this supplier and invoice number already exists.")
				break
			}
		}
	}
	if err := s.Imports.Save(r.Context(), item, item.Version); err != nil {
		return item, err
	}
	item.Version++
	item.UpdatedAt = time.Now().UTC()
	return item, nil
}

func (s *Server) getImport(w http.ResponseWriter, r *http.Request) {
	id, ok := s.importID(w, r)
	if !ok {
		return
	}
	item, err := s.Imports.Get(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return
	}
	reply(w, 200, item)
}

func (s *Server) rescan(w http.ResponseWriter, r *http.Request) {
	id, ok := s.importID(w, r)
	if !ok {
		return
	}
	var input struct{}
	if !decode(w, r, &input) {
		return
	}
	item, err := s.Imports.Get(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return
	}
	data, err := s.Imports.Bytes(r.Context(), id)
	if err == nil {
		item, err = s.scanImport(r, item, data)
	}
	if err != nil {
		apiError(w, err)
		return
	}
	reply(w, 200, item)
}

func (s *Server) original(w http.ResponseWriter, r *http.Request) {
	id, ok := s.importID(w, r)
	if !ok {
		return
	}
	item, err := s.Imports.Get(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return
	}
	data, err := s.Imports.Bytes(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return
	}
	w.Header().Set("Content-Type", item.ContentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": item.Filename}))
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	if _, err := w.Write(data); err != nil {
		slog.Error("download original", "error", err)
	}
}

func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	id, ok := s.importID(w, r)
	if !ok {
		return
	}
	if s.Scanner == nil {
		reply(w, 503, map[string]string{"error": "PDF preview is not configured."})
		return
	}
	page := 1
	if value := r.URL.Query().Get("page"); value != "" {
		var err error
		page, err = strconv.Atoi(value)
		if err != nil || page < 1 || page > MaxScanPages {
			apiError(w, invalid("invalid preview page"))
			return
		}
	}
	item, err := s.Imports.Get(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return
	}
	data, err := s.Imports.Bytes(r.Context(), id)
	contentType := ""
	if err != nil {
		apiError(w, err)
		return
	}
	data, contentType, err = s.Scanner.Preview(r.Context(), data, item.ContentType, page)
	if err != nil {
		apiError(w, invalid("original could not be previewed; download it or retry with a valid PDF/image"))
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	if _, err := w.Write(data); err != nil {
		slog.Error("write original preview", "error", err)
	}
}

func (s *Server) importDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := s.importID(w, r)
	if !ok {
		return
	}
	var input struct {
		draftRequest
		Reviewed       bool `json:"reviewed"`
		AcceptMismatch bool `json:"acceptMismatch"`
	}
	if !decode(w, r, &input) {
		return
	}
	item, err := s.Imports.Get(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return
	}
	// The import ID is also the draft ID: retries can never create a second bill.
	if existing, err := s.Store.Get(r.Context(), id); err == nil {
		existing.NormalizeOwnership()
		if existing.OrganisationID != s.Company || existing.ProjectID != s.Company {
			apiError(w, ErrNotFound)
			return
		}
		if existing.SourceID == nil || *existing.SourceID != id {
			apiError(w, ErrConflict)
			return
		}
		item.DocumentID, item.Status = &id, "draft"
		if err := s.Imports.Save(r.Context(), item, item.Version); err != nil {
			apiError(w, err)
			return
		}
		reply(w, 200, existing)
		return
	} else if !errors.Is(err, ErrNotFound) {
		apiError(w, err)
		return
	}
	if !input.Reviewed || input.Kind != "bill" || item.Status == "scanning" || item.Status == "pending" {
		apiError(w, invalid("review the original and all fields before creating a bill draft"))
		return
	}
	if item.Scan.Currency != "" && item.Scan.Currency != "EUR" {
		apiError(w, invalid("only EUR bills can be converted in this release"))
		return
	}
	doc, err := s.newDraft(r.Context(), input.draftRequest)
	if err != nil {
		apiError(w, err)
		return
	}
	if item.Scan.Total > 0 && doc.Total != item.Scan.Total && !input.AcceptMismatch {
		apiError(w, invalid("entered lines do not match the scanned total; correct them or explicitly confirm the scan-total discrepancy"))
		return
	}
	doc.ID, doc.SourceID, doc.Number = id, &id, "BILL-"+strings.ToUpper(id.Hex())
	if err := s.Store.Create(r.Context(), doc); err != nil {
		if mongo.IsDuplicateKeyError(err) || errors.Is(err, ErrConflict) {
			existing, findErr := s.Store.Get(r.Context(), id)
			if findErr != nil {
				apiError(w, findErr)
				return
			}
			existing.NormalizeOwnership()
			if existing.OrganisationID != s.Company || existing.ProjectID != s.Company || existing.SourceID == nil || *existing.SourceID != id {
				apiError(w, ErrNotFound)
				return
			}
			doc = existing
		} else {
			apiError(w, err)
			return
		}
	}
	item.DocumentID, item.Status = &id, "draft"
	if input.AcceptMismatch {
		item.Scan.Warnings = append(item.Scan.Warnings, "Reviewer explicitly accepted a discrepancy between the scanned total and the entered bill total.")
	}
	if err := s.Imports.Save(r.Context(), item, item.Version); err != nil {
		apiError(w, err)
		return
	}
	reply(w, 201, doc)
}
