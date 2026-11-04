package accounting

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Capability string

const (
	Read  Capability = "read"
	Write Capability = "write"
	Post  Capability = "post"
	Admin Capability = "admin"
)

type Grant struct {
	Principal    string             `json:"principal"`
	CompanyID    primitive.ObjectID `json:"companyId"`
	Capabilities []Capability       `json:"capabilities"`
}

// Authorization is loaded once at startup. Configuration changes require restart.
type Authorization struct {
	mode   string
	grants map[string][]Grant
}

func validPrincipal(value string) bool {
	if value == "token:company" || value == "development:local" {
		return true
	}
	if !strings.HasPrefix(value, "github:") {
		return false
	}
	id := strings.TrimPrefix(value, "github:")
	n, err := strconv.ParseInt(id, 10, 64)
	return err == nil && n > 0 && strconv.FormatInt(n, 10) == id
}

func ParseAuthorization(mode, raw string) (*Authorization, error) {
	if mode == "" {
		mode = "compatibility"
	}
	if mode != "compatibility" && mode != "enforced" {
		return nil, fmt.Errorf("ODEE_AUTHZ_MODE must be compatibility or enforced")
	}
	policy := &Authorization{mode: mode, grants: map[string][]Grant{}}
	if strings.TrimSpace(raw) == "" {
		return policy, nil
	}
	var grants []Grant
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&grants); err != nil || grants == nil {
		return nil, fmt.Errorf("ODEE_CAPABILITY_GRANTS must be an array of principal/companyId/capabilities records")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("ODEE_CAPABILITY_GRANTS must contain one JSON array")
	}
	for _, grant := range grants {
		if !validPrincipal(grant.Principal) || grant.CompanyID.IsZero() || grant.Capabilities == nil {
			return nil, fmt.Errorf("invalid principal, companyId or capabilities in ODEE_CAPABILITY_GRANTS")
		}
		set := map[Capability]bool{}
		for _, capability := range grant.Capabilities {
			if capability != Read && capability != Write && capability != Post && capability != Admin || set[capability] {
				return nil, fmt.Errorf("unknown or duplicate capability in ODEE_CAPABILITY_GRANTS")
			}
			set[capability] = true
		}
		// Canonical order also makes identical duplicate grants harmless.
		grant.Capabilities = []Capability{}
		for _, capability := range []Capability{Read, Write, Post, Admin} {
			if set[capability] {
				grant.Capabilities = append(grant.Capabilities, capability)
			}
		}
		duplicate := false
		for _, prior := range policy.grants[grant.Principal] {
			if prior.CompanyID == grant.CompanyID {
				if fmt.Sprint(prior.Capabilities) != fmt.Sprint(grant.Capabilities) {
					return nil, fmt.Errorf("conflicting duplicate principal/company grant")
				}
				duplicate = true
			}
		}
		if !duplicate {
			policy.grants[grant.Principal] = append(policy.grants[grant.Principal], grant)
		}
	}
	return policy, nil
}

type Access struct {
	Principal    string             `json:"principal"`
	Mode         string             `json:"authorizationMode"`
	CompanyID    primitive.ObjectID `json:"companyId"`
	Member       bool               `json:"member"`
	Capabilities []Capability       `json:"capabilities"`
}

func (p *Authorization) access(principal string, company primitive.ObjectID) Access {
	result := Access{Principal: principal, Mode: "compatibility", CompanyID: company, Capabilities: []Capability{}}
	if p != nil {
		result.Mode = p.mode
	}
	if !validPrincipal(principal) || company.IsZero() {
		return result
	}
	if p != nil {
		for _, grant := range p.grants[principal] {
			if grant.CompanyID == company {
				result.Member = true
				result.Capabilities = append(result.Capabilities, grant.Capabilities...)
				return result
			}
		}
		if len(p.grants[principal]) != 0 || p.mode == "enforced" {
			return result
		}
	}
	result.Member, result.Capabilities = true, []Capability{Read, Write, Post}
	return result
}

func (a Access) allows(required ...Capability) bool {
	if !a.Member {
		return false
	}
	for _, want := range required {
		found := false
		for _, have := range a.Capabilities {
			found = found || have == want
		}
		if !found {
			return false
		}
	}
	return true
}

type principalKey struct{}

func (s *Server) principal(r *http.Request) string {
	if s.Auth != nil {
		session, ok := s.Auth.readSession(r)
		if !ok {
			return ""
		}
		return "github:" + strconv.FormatInt(session.User.ID, 10)
	}
	if s.Dev {
		return "development:local"
	}
	if s.validToken(r) {
		return "token:company"
	}
	return ""
}

func (s *Server) require(handler http.HandlerFunc, required ...Capability) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal := s.principal(r)
		if !s.Authorization.access(principal, s.Company).allows(required...) {
			reply(w, http.StatusForbidden, map[string]string{
				"error": "Access forbidden. Ask your workspace administrator for company membership and the required capabilities: " + fmt.Sprint(required) + ". Your session is still signed in; do not retry an unconfirmed change.",
			})
			return
		}
		handler(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, principal)))
	}
}

func (s *Server) RegisterAuthentication(mux *http.ServeMux) {
	if s.Auth != nil {
		s.Auth.register(mux, s.session)
	} else {
		mux.HandleFunc("GET /api/session", s.session)
	}
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	principal := s.principal(r)
	mode := "token"
	response := map[string]any{"authenticated": principal != ""}
	if s.Auth != nil {
		mode = "github"
		response["organisation"], response["team"] = s.Auth.config.Organisation, s.Auth.config.Team
		if session, ok := s.Auth.readSession(r); ok {
			response["user"], response["csrfToken"] = session.User, session.CSRF
		}
	} else if s.Dev {
		mode = "development"
	}
	response["authMode"] = mode
	if principal != "" {
		response["access"] = s.Authorization.access(principal, s.Company)
	}
	w.Header().Set("Cache-Control", "no-store")
	reply(w, http.StatusOK, response)
}
