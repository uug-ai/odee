package accounting

import (
	"context"
	"net/http"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

const MaxFinancialEvents = 201

type FinancialEvent struct {
	ID        primitive.ObjectID `json:"id" bson:"id"`
	Time      time.Time          `json:"time" bson:"time"`
	ActorType string             `json:"actorType" bson:"actorType"`
	Principal string             `json:"principal" bson:"principal"`
	Action    string             `json:"action" bson:"action"`
	TargetID  primitive.ObjectID `json:"targetId" bson:"targetId"`
	Version   int64              `json:"version" bson:"version"`
	Outcome   string             `json:"outcome" bson:"outcome"`
}

func (d *Document) attribute(ctx context.Context, action string) error {
	principal, _ := ctx.Value(principalKey{}).(string)
	if !validPrincipal(principal) || (action != "document.post" && action != "manual-payment.record") {
		return invalid("financial attribution requires a server principal and supported action")
	}
	if len(d.FinancialEvents) >= MaxFinancialEvents {
		return invalid("financial history limit reached; reconcile this document before proceeding")
	}
	d.pendingEvent = &FinancialEvent{
		ID: primitive.NewObjectID(), Time: time.Now().UTC(),
		ActorType: strings.SplitN(principal, ":", 2)[0], Principal: principal,
		Action: action, TargetID: d.ID, Version: d.Version + 1, Outcome: "committed",
	}
	return nil
}

func (s *Server) audit(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		apiError(w, invalid("invalid document ID"))
		return
	}
	doc, err := s.Store.Get(r.Context(), id)
	if err != nil {
		apiError(w, err)
		return
	}
	doc.NormalizeOwnership()
	if doc.OrganisationID != s.Company || doc.ProjectID != s.Company {
		apiError(w, ErrNotFound)
		return
	}
	events := make([]FinancialEvent, 0, len(doc.FinancialEvents))
	for _, event := range doc.FinancialEvents {
		// Allowlist attribution only, including when legacy storage contains extras.
		if !(validPrincipal(event.Principal) && event.ActorType == strings.SplitN(event.Principal, ":", 2)[0] &&
			(event.Action == "document.post" || event.Action == "manual-payment.record") &&
			event.TargetID == doc.ID && event.Outcome == "committed" && event.Version > 0 && !event.ID.IsZero() && !event.Time.IsZero()) {
			reply(w, http.StatusServiceUnavailable, map[string]string{
				"error": "Financial history requires reconciliation; no partial audit has been returned.",
				"code":  "reconciliation_required",
			})
			return
		}
		event.Time = event.Time.UTC()
		events = append(events, event)
	}
	reply(w, http.StatusOK, map[string]any{"events": events})
}
