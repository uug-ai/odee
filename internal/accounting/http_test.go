package accounting

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func apiRequest(handler http.Handler, method, path, body, token, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", origin)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestAPIWorkflow(t *testing.T) {
	origin := "http://localhost:8098"
	s := &Server{Store: NewMemoryStore(), Company: testCompany, Name: "Example", Dev: true, Origin: origin}
	handler := s.Handler()
	encoded, _ := json.Marshal(draft("invoice"))
	w := apiRequest(handler, "POST", "/api/documents", string(encoded), "", origin)
	if w.Code != http.StatusCreated {
		t.Fatalf("create %d: %s", w.Code, w.Body)
	}
	var doc Document
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	path := "/api/documents/" + doc.ID.Hex()
	w = apiRequest(handler, "POST", path+"/post", `{"version":1}`, "", origin)
	if w.Code != http.StatusOK {
		t.Fatalf("post %d: %s", w.Code, w.Body)
	}
	w = apiRequest(handler, "POST", path+"/post", `{"version":1}`, "", origin)
	if w.Code != http.StatusConflict {
		t.Fatalf("stale posting status=%d", w.Code)
	}
	w = apiRequest(handler, "POST", path+"/payments", `{"version":2,"id":"payment-1","amount":24200,"date":"2026-11-03","reference":"Transfer"}`, "", origin)
	if w.Code != http.StatusOK {
		t.Fatalf("pay %d: %s", w.Code, w.Body)
	}
	var paid Document
	if err := json.Unmarshal(w.Body.Bytes(), &paid); err != nil {
		t.Fatal(err)
	}
	if paid.Status != "paid" || paid.Version != 3 || paid.Paid != 24200 || len(paid.Payments) != 1 {
		t.Fatalf("paid document: %+v", paid)
	}
	w = apiRequest(handler, "POST", path+"/payments", `{"version":2,"id":"payment-1","amount":24200,"date":"2026-11-03","reference":"Transfer"}`, "", origin)
	if w.Code != http.StatusConflict {
		t.Fatal("repeat payment must not be recorded")
	}
	input := draft("invoice")
	edit, _ := json.Marshal(struct {
		Version int64 `json:"version"`
		Draft
	}{3, input})
	w = apiRequest(handler, "PUT", path, string(edit), "", origin)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatal("paid invoice edit must fail")
	}
	w = apiRequest(handler, "GET", "/api/state", "", "", "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"status":"paid"`)) {
		t.Fatalf("state: %d %s", w.Code, w.Body)
	}
}

func TestDevelopmentLoopbackOrigins(t *testing.T) {
	for _, test := range []struct {
		name, configured, incoming, host string
		dev, github, allowed             bool
	}{
		{"localhost alias", "http://127.0.0.1:8098", "http://localhost:8098", "localhost:8098", true, false, true},
		{"IPv4 alias", "http://localhost:8098", "http://127.0.0.1:8098", "127.0.0.1:8098", true, false, true},
		{"IPv6 alias", "http://127.0.0.1:8098", "http://[::1]:8098", "[::1]:8098", true, false, true},
		{"different port", "http://127.0.0.1:8098", "http://localhost:8099", "localhost:8099", true, false, false},
		{"different scheme", "http://127.0.0.1:8098", "https://localhost:8098", "localhost:8098", true, false, false},
		{"different request host", "http://127.0.0.1:8098", "http://localhost:8098", "evil.example:8098", true, false, false},
		{"external origin", "http://127.0.0.1:8098", "http://evil.example:8098", "evil.example:8098", true, false, false},
		{"lookalike hostname", "http://127.0.0.1:8098", "http://localhost.evil.example:8098", "localhost.evil.example:8098", true, false, false},
		{"origin credentials", "http://127.0.0.1:8098", "http://user@localhost:8098", "localhost:8098", true, false, false},
		{"origin path", "http://127.0.0.1:8098", "http://localhost:8098/path", "localhost:8098", true, false, false},
		{"origin query", "http://127.0.0.1:8098", "http://localhost:8098?x=1", "localhost:8098", true, false, false},
		{"origin fragment", "http://127.0.0.1:8098", "http://localhost:8098#x", "localhost:8098", true, false, false},
		{"missing origin", "http://127.0.0.1:8098", "", "localhost:8098", true, false, false},
		{"opaque origin", "http://127.0.0.1:8098", "null", "localhost:8098", true, false, false},
		{"invalid URL", "http://127.0.0.1:8098", "http://[invalid", "localhost:8098", true, false, false},
		{"public configured origin", "https://odee.example", "https://localhost", "localhost", true, false, false},
		{"production token mode", "http://127.0.0.1:8098", "http://localhost:8098", "localhost:8098", false, false, false},
		{"GitHub never permits aliases", "http://127.0.0.1:8098", "http://localhost:8098", "localhost:8098", true, true, false},
		{"exact production origin", "https://odee.example", "https://odee.example", "backend.internal", false, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := &Server{Origin: test.configured, Dev: test.dev}
			if test.github {
				server.Auth = &GitHubAuth{}
			}
			r := httptest.NewRequest(http.MethodPost, "/api/documents", nil)
			r.Host = test.host
			r.Header.Set("Origin", test.incoming)
			r.Header.Set("X-Forwarded-Host", "localhost:8098")
			if allowed := server.allowsOrigin(r); allowed != test.allowed {
				t.Fatalf("origin allowed=%v, expected %v", allowed, test.allowed)
			}
		})
	}
}

func TestAPISavesDraftFromDevelopmentLoopbackAlias(t *testing.T) {
	store := NewMemoryStore()
	handler := (&Server{Store: store, Company: testCompany, Dev: true, Origin: "http://127.0.0.1:8098"}).Handler()
	body, err := json.Marshal(draft("bill"))
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "http://localhost:8098/api/documents", bytes.NewReader(body))
	r.Header.Set("Origin", "http://localhost:8098")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusCreated {
		t.Fatalf("same-port development alias could not save a draft: %d %s", w.Code, w.Body)
	}
	var doc Document
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Status != "draft" || doc.Paid != 0 || len(doc.Entries) != 0 || len(doc.Payments) != 0 {
		t.Fatal("saving from a local alias must only create a draft")
	}
}
func TestAPIAuthorizationAndValidation(t *testing.T) {
	token, origin := strings.Repeat("a", 32), "https://odee.example"
	handler := (&Server{Store: NewMemoryStore(), Company: testCompany, Token: token, Origin: origin}).Handler()
	for _, candidate := range []string{"", "bad-token"} {
		if w := apiRequest(handler, "GET", "/api/state", "", candidate, ""); w.Code != 401 {
			t.Fatalf("unauthorized status %d", w.Code)
		}
	}
	if w := apiRequest(handler, "GET", "/api/state", "", token, ""); w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("authenticated read failed")
	}
	if w := apiRequest(handler, "POST", "/api/documents", `{}`, token, "https://evil.example"); w.Code != 403 {
		t.Fatal("cross-origin write must fail")
	}
	for _, payload := range []string{
		`{}`, `{"kind":"invoice","organisationId":"spoof"}`, `{} {}`, `{"version":1.5}`,
		`{"lines":[{"quantity":1.5}]}`, `{broken`, strings.Repeat("x", 128*1024+1),
	} {
		w := apiRequest(handler, "POST", "/api/documents", payload, token, origin)
		if w.Code != 400 && w.Code != 422 {
			t.Fatalf("invalid payload returned %d", w.Code)
		}
	}
	w := apiRequest(handler, "POST", "/api/documents/not-an-id/post", `{"version":1}`, token, origin)
	if w.Code != 422 {
		t.Fatal("invalid ID must fail")
	}
}
