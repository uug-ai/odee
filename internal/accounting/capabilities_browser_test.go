package accounting

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// This opt-in fixture runs real middleware/stores with only a local OAuth provider.
// It is never registered in the production binary.
func TestCapabilitiesBrowserFixture(t *testing.T) {
	addr := os.Getenv("ODEE_TEST_BROWSER_ADDR")
	if addr == "" {
		t.Skip("opt-in local browser fixture, run node web/tests/capabilities.mjs")
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil || host != "127.0.0.1" || port == "8098" || port == "0" {
		t.Fatal("fixture requires an owned non-shared loopback listener")
	}
	uri, name := os.Getenv("ODEE_TEST_MONGODB_URI"), os.Getenv("MONGODB_DATABASE_ODEE")
	if !strings.HasPrefix(uri, "mongodb://127.0.0.1:") || !strings.HasPrefix(name, "odee_test_") {
		t.Fatal("fixture requires disposable local MongoDB")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	company, err := primitive.ObjectIDFromHex(os.Getenv("ODEE_COMPANY_ID"))
	if err != nil || company.IsZero() {
		t.Fatal("fixture company must be an explicit BSON ObjectID")
	}
	store, err := OpenMongo(ctx, uri, name, company)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Client.Disconnect(context.Background())
	contacts, err := NewMongoContacts(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	imports, err := NewMongoImports(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := NewDocument(draft("invoice"), company)
	doc.Partner = "Synthetic permission draft"
	if err := store.Create(ctx, doc); err != nil {
		t.Fatal(err)
	}
	posted, _ := NewDocument(draft("invoice"), company)
	posted.Partner = "Synthetic permission posted"
	if err := posted.Post(); err != nil {
		t.Fatal(err)
	}
	if err := store.Create(ctx, posted); err != nil {
		t.Fatal(err)
	}
	contact, _ := newContact(sampleContact(), company)
	if err := contacts.Create(ctx, contact); err != nil {
		t.Fatal(err)
	}
	policy, err := ParseAuthorization(os.Getenv("ODEE_AUTHZ_MODE"), os.Getenv("ODEE_CAPABILITY_GRANTS"))
	if err != nil {
		t.Fatal(err)
	}
	origin := "http://" + addr
	s := &Server{Store: store, Company: company, Name: "Synthetic capabilities",
		Origin: origin, Contacts: contacts, Imports: imports, Scanner: NewScanner("eng"),
		Authorization: policy, Token: strings.Repeat("synthetic-browser-token-", 2)}
	mode := os.Getenv("ODEE_TEST_BROWSER_AUTH_MODE")
	if mode == "github" {
		mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Log("local OAuth request", r.URL.Path)
			switch r.URL.Path {
			case "/token":
				reply(w, 200, map[string]string{"access_token": "local-oauth-fixture", "token_type": "bearer"})
			case "/user":
				reply(w, 200, GitHubUser{ID: 42, Login: "renamable-login", Name: "Synthetic Member"})
			case "/orgs/synthetic/teams/fixture/memberships/renamable-login":
				reply(w, 200, map[string]string{"state": "active", "role": "member"})
			default:
				t.Errorf("unexpected local provider path %s", r.URL.Path)
				http.NotFound(w, r)
			}
		}))
		t.Log("local OAuth mock", mock.Listener.Addr().String())
		defer mock.Close()
		s.Auth, err = NewGitHubAuth(AuthConfig{
			Origin: origin, ClientID: "synthetic-client", ClientSecret: "synthetic-secret",
			Organisation: "synthetic", Team: "fixture", SessionKey: strings.Repeat("synthetic-session-", 3),
		})
		if err != nil {
			t.Fatal(err)
		}
		s.Auth.oauthURL, s.Auth.apiURL = mock.URL+"/token", mock.URL
	} else if mode == "development" {
		s.Dev = true
	} else if mode != "token" {
		t.Fatal("invalid fixture auth mode")
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", s.Handler())
	s.RegisterAuthentication(mux)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	if s.Auth != nil {
		mux.HandleFunc("GET /fixture/expired", func(w http.ResponseWriter, _ *http.Request) {
			cookie := authCookie(t, s.Auth, time.Now().Add(-time.Minute))
			cookie.Path, cookie.HttpOnly = "/", true
			http.SetCookie(w, cookie)
			w.WriteHeader(204)
		})
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		web := os.Getenv("ODEE_WEB_DIR")
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			http.FileServer(http.Dir(web)).ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(web, "index.html"))
	})
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	metadata, _ := json.Marshal(map[string]string{"draft": doc.ID.Hex(), "posted": posted.ID.Hex(), "contact": contact.ID.Hex()})
	t.Log("fixture ready", string(metadata))
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdown); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != http.ErrServerClosed {
		t.Fatal(err)
	}
}
