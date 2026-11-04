package accounting

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestGitHubBrowserOAuth(t *testing.T) {
	if os.Getenv("ODEE_TEST_BROWSER") != "true" {
		t.Skip("run npm run test:oauth in web after building the frontend")
	}
	mux := http.NewServeMux()
	app := httptest.NewUnstartedServer(mux)
	defer app.Close()
	origin := "http://" + app.Listener.Addr().String()
	config := testGitHubAuth(t).config
	config.Origin = origin
	auth, err := NewGitHubAuth(config)
	if err != nil {
		t.Fatal(err)
	}
	var mutex sync.Mutex
	var challenge string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/authorize":
			query := r.URL.Query()
			if query.Get("redirect_uri") != origin+"/auth/github/callback" || query.Get("code_challenge_method") != "S256" || query.Get("state") == "" {
				t.Error("invalid browser authorization request")
				w.WriteHeader(400)
				return
			}
			mutex.Lock()
			challenge = query.Get("code_challenge")
			mutex.Unlock()
			callback := origin + "/auth/github/callback?" + url.Values{"state": {query.Get("state")}, "code": {"browser-test-code"}}.Encode()
			http.Redirect(w, r, callback, http.StatusFound)
		case "/token":
			if err := r.ParseForm(); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			hash := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			mutex.Lock()
			matches := challenge != "" && challenge == base64.RawURLEncoding.EncodeToString(hash[:])
			mutex.Unlock()
			if !matches || r.Form.Get("client_secret") != "test-secret" || r.Form.Get("code") != "browser-test-code" || r.Form.Get("redirect_uri") != origin+"/auth/github/callback" {
				t.Error("browser callback failed code, credential or PKCE verification")
				w.WriteHeader(400)
				return
			}
			reply(w, 200, map[string]string{"access_token": "fixture-provider-token"})
		case "/user":
			if r.Header.Get("Authorization") != "Bearer fixture-provider-token" {
				t.Error("provider request missing access token")
			}
			reply(w, 200, GitHubUser{ID: 42, Login: "browser-member", Name: "Browser Member"})
		case "/orgs/uug-ai/teams/engineering/memberships/browser-member":
			reply(w, 200, map[string]string{"state": "active"})
		default:
			t.Errorf("unexpected provider path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer provider.Close()
	auth.authorizeURL = strings.Replace(provider.URL, "127.0.0.1", "localhost", 1) + "/authorize"
	auth.oauthURL, auth.apiURL = provider.URL+"/token", provider.URL
	mux.Handle("/api/", (&Server{
		Store: NewMemoryStore(), Contacts: NewMemoryContacts(testCompany), Company: testCompany,
		Name: "OAuth test workspace", Origin: origin, Auth: auth,
	}).Handler())
	auth.Register(mux)
	static := http.FileServer(http.Dir(filepath.Join("..", "..", "web", "dist")))
	mux.Handle("GET /{$}", static)
	mux.Handle("GET /assets/", static)
	app.Start()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "tests/oauth.mjs")
	cmd.Dir = filepath.Join("..", "..", "web")
	cmd.Env = append(os.Environ(), "ODEE_TEST_ORIGIN="+origin)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("OAuth browser round-trip failed: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "OAuth browser round-trip passed") {
		t.Fatalf("browser verification did not finish: %s", output)
	}
}
