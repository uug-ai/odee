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
