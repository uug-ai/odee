package accounting

import (
	"errors"
	"net/http"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type configurationView struct {
	Stage        ConfigurationStage   `json:"stage"`
	Default      ConfigurationDefault `json:"default"`
	Readiness    map[string][]string  `json:"readiness"`
	DefaultData  *ConfigurationData   `json:"defaultData"`
	DefaultError string               `json:"defaultError,omitempty"`
}

func (s *Server) configurationView(r *http.Request) (configurationView, error) {
	head, err := s.Store.Configuration(s.Company).Head(r.Context())
	if errors.Is(err, ErrNotFound) {
		head = ConfigurationHead{Stage: ConfigurationStage{Data: starterConfiguration()}}
	} else if err != nil {
		return configurationView{}, err
	}
	view := configurationView{Stage: head.Stage, Default: head.Default, Readiness: map[string][]string{"invoice": head.Stage.Data.readiness("invoice"), "bill": head.Stage.Data.readiness("bill")}}
	if head.Default.VersionID == nil && head.Default.Revision == 0 {
		data := starterConfiguration()
		view.DefaultData = &data
	} else if head.Default.VersionID != nil {
		p, loadErr := s.Store.Configuration(s.Company).Published(r.Context(), *head.Default.VersionID)
		if loadErr != nil {
			view.DefaultError = "Default configuration requires reconciliation"
		} else {
			view.DefaultData = &p.Payload.Data
		}
	} else {
		view.DefaultError = "Default configuration requires reconciliation"
	}
	return view, nil
}
func (s *Server) getConfiguration(w http.ResponseWriter, r *http.Request) {
	view, err := s.configurationView(r)
	if err != nil {
		apiError(w, err)
		return
	}
	reply(w, 200, view)
}
func (s *Server) stageConfiguration(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedStageVersion int64             `json:"expectedStageVersion"`
		Data                 ConfigurationData `json:"data"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.ExpectedStageVersion < 0 {
		apiError(w, ErrConflict)
		return
	}
	if err := input.Data.normalize(); err != nil {
		apiError(w, err)
		return
	}
	stage := ConfigurationStage{input.ExpectedStageVersion + 1, primitive.NewObjectID(), input.Data, configurationDigest(input.Data), time.Now().UTC()}
	if err := s.Store.Configuration(s.Company).SaveStage(r.Context(), stage, input.ExpectedStageVersion); err != nil {
		apiError(w, err)
		return
	}
	reply(w, 200, stage)
}
func (s *Server) publishConfiguration(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedStageVersion int64              `json:"expectedStageVersion"`
		PublicationID        primitive.ObjectID `json:"publicationId"`
	}
	if !decode(w, r, &input) {
		return
	}
	p, err := publishConfiguration(r.Context(), s.Store.Configuration(s.Company), s.Company, input.ExpectedStageVersion, input.PublicationID)
	if err != nil {
		if errors.Is(err, ErrUncertain) {
			reply(w, 503, map[string]any{"error": ErrUncertain.Error(), "code": "reconciliation_required", "publicationId": input.PublicationID})
			return
		}
		apiError(w, err)
		return
	}
	reply(w, 200, p)
}
func (s *Server) getPublishedConfiguration(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(r.PathValue("id"))
	if err != nil || id.IsZero() {
		apiError(w, invalid("invalid configuration ID"))
		return
	}
	p, err := s.Store.Configuration(s.Company).Published(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return
	}
	reply(w, 200, p)
}
func (s *Server) listPublishedConfigurations(w http.ResponseWriter, r *http.Request) {
	var after *PublishedConfiguration
	if cursor := r.URL.Query().Get("after"); cursor != "" {
		id, err := primitive.ObjectIDFromHex(cursor)
		if err != nil || id.IsZero() {
			apiError(w, invalid("invalid configuration cursor"))
			return
		}
		p, err := s.Store.Configuration(s.Company).Published(r.Context(), id)
		if err != nil {
			apiError(w, err)
			return
		}
		after = &p
	}
	items, err := s.Store.Configuration(s.Company).Versions(r.Context(), after)
	if err != nil {
		apiError(w, err)
		return
	}
	next := ""
	if len(items) > 50 {
		items = items[:50]
		next = items[49].ID.Hex()
	}
	reply(w, 200, map[string]any{"items": items, "next": next})
}
func (s *Server) activateConfiguration(w http.ResponseWriter, r *http.Request) {
	var input struct {
		VersionID               primitive.ObjectID `json:"versionId"`
		ExpectedDefaultRevision int64              `json:"expectedDefaultRevision"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.VersionID.IsZero() {
		apiError(w, invalid("invalid configuration ID"))
		return
	}
	store := s.Store.Configuration(s.Company)
	p, err := store.Published(r.Context(), input.VersionID)
	if err == nil {
		err = store.Activate(r.Context(), p, input.ExpectedDefaultRevision)
	}
	if err != nil {
		apiError(w, err)
		return
	}
	reply(w, 200, ConfigurationDefault{input.ExpectedDefaultRevision + 1, &p.ID})
}
func (s *Server) rebindConfiguration(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Version         int64              `json:"version"`
		TargetVersionID primitive.ObjectID `json:"targetVersionId"`
		JournalCode     *string            `json:"journalCode"`
	}
	if !decode(w, r, &input) {
		return
	}
	doc, ok := s.load(w, r, input.Version)
	if !ok {
		return
	}
	if doc.Status != "draft" {
		apiError(w, invalid("posted documents are immutable"))
		return
	}
	p, err := s.Store.Configuration(s.Company).Published(r.Context(), input.TargetVersionID)
	if err != nil {
		apiError(w, err)
		return
	}
	doc.ConfigurationSelection = &ConfigurationSelection{VersionID: &p.ID, Digest: p.Payload.Digest}
	if input.JournalCode != nil {
		if len(*input.JournalCode) > 24 {
			apiError(w, invalid("invalid journal code"))
			return
		}
		doc.JournalCode = *input.JournalCode
	}
	s.save(w, r, doc, nil)
}
