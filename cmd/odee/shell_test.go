package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWebShellRoutesAndReservedNamespaces(t *testing.T) {
	dist := t.TempDir()
	const shell = `<!doctype html><div id="root"></div>`
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte(shell), 0600); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/state" {
			http.Error(w, "authentication required", http.StatusUnauthorized)
		} else {
			http.NotFound(w, r)
		}
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	handler := registerWeb(mux, dist)
	for _, path := range []string{
		"/", "/accounting", "/accounting/invoices", "/accounting/bills", "/accounting/journal",
		"/accounting/accounts", "/accounting/reports", "/contacts", "/sales", "/not-registered", "/index.html",
	} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			if rec.Code != 200 || rec.Body.String() != shell || rec.Header().Get("Cache-Control") != "no-cache" {
				t.Fatalf("UI path did not receive the public shell: %d %s", rec.Code, rec.Body)
			}
		})
	}
	for _, test := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/api/state", 401},
		{"GET", "/api/unknown", 404},
		{"GET", "/auth", 404},
		{"GET", "/auth/unknown", 404},
		{"GET", "/assets/missing.js", 404},
		{"GET", "/healthz/unknown", 404},
		{"POST", "/contacts", 405},
		{"POST", "/healthz", 405},
	} {
		t.Run(test.method+test.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(test.method, test.path, nil))
			if rec.Code != test.status || strings.Contains(rec.Body.String(), `id="root"`) {
				t.Fatalf("reserved/method response became a shell: %d %s", rec.Code, rec.Body)
			}
		})
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != 200 || rec.Body.String() != "ok" {
		t.Fatal("health response changed")
	}
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("HEAD", "/contacts", nil))
	if rec.Code != 200 || rec.Body.Len() != 0 {
		t.Fatal("HEAD must return shell headers without a body")
	}
}
