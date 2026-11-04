package accounting

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func testGitHubAuth(t *testing.T) *GitHubAuth {
	t.Helper()
	auth, err := NewGitHubAuth(AuthConfig{
		Origin: "https://odee.example", ClientID: "test-client", ClientSecret: "test-secret",
		Organisation: "uug-ai", Team: "engineering", SessionKey: strings.Repeat("s", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	return auth
}

func authHandler(auth *GitHubAuth) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", (&Server{
		Store: NewMemoryStore(), Contacts: NewMemoryContacts(testCompany), Company: testCompany,
		Auth: auth, Origin: auth.config.Origin,
		// Even an accidentally enabled bypass or legacy bearer token must not bypass GitHub.
		Dev: true, Token: strings.Repeat("t", 32),
	}).Handler())
	auth.Register(mux)
	return mux
}

func authRequest(handler http.Handler, method, path, body string, cookies []*http.Cookie, csrf, origin string) *httptest.ResponseRecorder {
	target := path
	if strings.HasPrefix(path, "/") {
		target = "https://odee.example" + path
	}
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-CSRF-Token", csrf)
	r.Header.Set("Origin", origin)
	for _, cookie := range cookies {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func authCookie(t *testing.T, auth *GitHubAuth, expires time.Time) *http.Cookie {
	t.Helper()
	data, err := json.Marshal(loginSession{User: GitHubUser{ID: 42, Login: "alice", Name: "Alice"}, CSRF: "test-csrf", Expires: expires.Unix()})
	if err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: auth.cookieName(), Value: auth.sign("session", data)}
}

func TestGitHubAuthConfiguration(t *testing.T) {
	base := testGitHubAuth(t).config
	for _, test := range []struct {
		name string
		edit func(*AuthConfig)
	}{
		{"missing client", func(c *AuthConfig) { c.ClientID = "" }},
		{"missing secret", func(c *AuthConfig) { c.ClientSecret = "" }},
		{"missing organisation", func(c *AuthConfig) { c.Organisation = "" }},
		{"missing team", func(c *AuthConfig) { c.Team = "" }},
		{"short session key", func(c *AuthConfig) { c.SessionKey = "short" }},
		{"unsafe team", func(c *AuthConfig) { c.Team = "../admins" }},
		{"unsafe organisation", func(c *AuthConfig) { c.Organisation = "uug-ai?admin" }},
		{"remote HTTP", func(c *AuthConfig) { c.Origin = "http://odee.example" }},
		{"origin credentials", func(c *AuthConfig) { c.Origin = "https://user@odee.example" }},
		{"origin path", func(c *AuthConfig) { c.Origin += "/app" }},
		{"origin query", func(c *AuthConfig) { c.Origin += "?x=y" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := base
			test.edit(&config)
			if _, err := NewGitHubAuth(config); err == nil {
				t.Fatal("invalid configuration accepted")
			}
		})
	}
	for _, origin := range []string{"http://localhost:8098", "http://127.0.0.1:8098", "http://[::1]:8098", "https://odee.example"} {
		config := base
		config.Origin = origin
		if _, err := NewGitHubAuth(config); err != nil {
			t.Fatalf("valid origin %s: %v", origin, err)
		}
	}
}

func TestGitHubProtectsEveryWorkspaceSurface(t *testing.T) {
	auth := testGitHubAuth(t)
	handler := authHandler(auth)
	for _, path := range []string{"/api/state", "/api/contacts", "/api/imports/000000000000000000000001/original", "/api/imports/000000000000000000000001/preview"} {
		if rec := authRequest(handler, "GET", path, "", nil, "", ""); rec.Code != 401 {
			t.Fatalf("%s allowed unauthenticated: %d", path, rec.Code)
		}
		if rec := apiRequest(handler, "GET", path, "", strings.Repeat("t", 32), ""); rec.Code != 401 {
			t.Fatalf("legacy bearer bypassed GitHub for %s", path)
		}
	}
	for _, path := range []string{"/api/contacts", "/api/contacts/import", "/api/documents", "/api/imports", "/api/logout"} {
		if rec := authRequest(handler, "POST", path, "{}", nil, "", auth.config.Origin); rec.Code != 401 {
			t.Fatalf("%s write allowed unauthenticated: %d", path, rec.Code)
		}
	}
	rec := authRequest(handler, "GET", "/api/session", "", nil, "", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"authenticated":false`) || strings.Contains(rec.Body.String(), "csrfToken") {
		t.Fatalf("invalid public session discovery: %d %s", rec.Code, rec.Body)
	}
}

func TestGitHubSessionIntegrityCSRFAndLogout(t *testing.T) {
	auth := testGitHubAuth(t)
	handler := authHandler(auth)
	cookie := authCookie(t, auth, time.Now().Add(time.Hour))
	cookies := []*http.Cookie{cookie}
	if rec := authRequest(handler, "GET", "/api/state", "", cookies, "", ""); rec.Code != 200 {
		t.Fatalf("signed-in read failed: %d", rec.Code)
	}
	for _, path := range []string{"/api/contacts", "/api/documents", "/api/imports", "/api/logout"} {
		for _, test := range []struct{ csrf, origin string }{
			{"", auth.config.Origin}, {"wrong", auth.config.Origin}, {"test-csrf", "https://evil.example"}, {"test-csrf", ""},
		} {
			if rec := authRequest(handler, "POST", path, "{}", cookies, test.csrf, test.origin); rec.Code != 403 {
				t.Fatalf("unverified write accepted for %s: %d", path, rec.Code)
			}
		}
	}
	rec := authRequest(handler, "POST", "/api/contacts", `{"name":"Session Example","type":"contact","active":true}`, cookies, "test-csrf", auth.config.Origin)
	if rec.Code != 201 {
		t.Fatalf("verified contact write failed: %d %s", rec.Code, rec.Body)
	}
	rec = authRequest(handler, "GET", "/api/session", "", cookies, "", "")
	if !strings.Contains(rec.Body.String(), `"login":"alice"`) || !strings.Contains(rec.Body.String(), `"csrfToken":"test-csrf"`) {
		t.Fatal("authenticated session discovery missing profile or CSRF")
	}
	rec = authRequest(handler, "POST", "/api/logout", "", cookies, "test-csrf", auth.config.Origin)
	result := rec.Result().Cookies()
	if rec.Code != 204 || len(result) != 1 || result[0].Name != "__Host-odee_session" || result[0].MaxAge != -1 || !result[0].HttpOnly || !result[0].Secure || result[0].Path != "/" || result[0].Domain != "" {
		t.Fatalf("logout did not remove the protected cookie: %d", rec.Code)
	}
	for _, candidate := range []*http.Cookie{
		{Name: cookie.Name, Value: cookie.Value + "forged"},
		authCookie(t, auth, time.Now().Add(-time.Minute)),
		authCookie(t, auth, time.Now().Add(2*time.Hour)),
		{Name: "calendar_session", Value: cookie.Value},
		{Name: cookie.Name, Value: strings.Repeat("a", 5000)},
	} {
		if rec := authRequest(handler, "GET", "/api/state", "", []*http.Cookie{candidate}, "", ""); rec.Code != 401 {
			t.Fatalf("invalid session accepted: %d", rec.Code)
		}
	}
	other := testGitHubAuth(t)
	other.config.Origin = "https://other.example"
	if rec := authRequest(authHandler(other), "GET", "/api/state", "", cookies, "", ""); rec.Code != 401 {
		t.Fatal("cookie was accepted for another origin")
	}
	other.config = auth.config
	other.config.Team = "other-team"
	if rec := authRequest(authHandler(other), "GET", "/api/state", "", cookies, "", ""); rec.Code != 401 {
		t.Fatal("cookie survived an access policy change")
	}
}

func TestGitHubOAuthTeamAuthorization(t *testing.T) {
	for _, test := range []struct {
		name       string
		status     int
		state      string
		tokenError bool
		want       int
	}{
		{"active member", 200, "active", false, 303},
		{"pending member", 200, "pending", false, 403},
		{"nonmember", 404, "", false, 403},
		{"membership outage", 503, "", false, 502},
		{"organisation forbidden", 403, "", false, 502},
		{"token rejected", 200, "active", true, 502},
	} {
		t.Run(test.name, func(t *testing.T) {
			auth := testGitHubAuth(t)
			handler := authHandler(auth)
			var challenge string
			fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/token":
					if err := r.ParseForm(); err != nil {
						t.Error(err)
					}
					hash := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
					if r.Form.Get("client_secret") != "test-secret" || r.Form.Get("redirect_uri") != auth.config.Origin+"/auth/github/callback" || base64.RawURLEncoding.EncodeToString(hash[:]) != challenge {
						t.Error("invalid token exchange or PKCE verifier")
					}
					if test.tokenError {
						reply(w, 200, map[string]string{"error": "bad_code"})
					} else {
						reply(w, 200, map[string]string{"access_token": "private-github-token"})
					}
				case "/user":
					if r.Header.Get("Authorization") != "Bearer private-github-token" {
						t.Error("missing access token")
					}
					reply(w, 200, GitHubUser{ID: 42, Login: "alice", Name: "Alice"})
				case "/orgs/uug-ai/teams/engineering/memberships/alice":
					reply(w, test.status, map[string]string{"state": test.state})
				default:
					t.Errorf("unexpected GitHub request %s", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer fake.Close()
			auth.oauthURL, auth.apiURL = fake.URL+"/token", fake.URL
			login := authRequest(handler, "GET", "/auth/github", "", nil, "", "")
			location, err := url.Parse(login.Header().Get("Location"))
			if err != nil || location.Host != "github.com" || location.Query().Get("scope") != "read:user read:org" || location.Query().Get("code_challenge_method") != "S256" {
				t.Fatal("invalid authorization redirect")
			}
			challenge = location.Query().Get("code_challenge")
			cookies := login.Result().Cookies()
			if len(cookies) != 1 || cookies[0].Name != "odee_oauth" || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode || cookies[0].MaxAge != 600 {
				t.Fatal("unsafe OAuth state cookie")
			}
			callback := "/auth/github/callback?code=valid&state=" + location.Query().Get("state")
			rec := authRequest(handler, "GET", callback, "", cookies, "", "")
			if rec.Code != test.want {
				t.Fatalf("callback = %d %s; want %d", rec.Code, rec.Body, test.want)
			}
			if test.want == 303 {
				var sessionCookie *http.Cookie
				for _, cookie := range rec.Result().Cookies() {
					if cookie.Name == auth.cookieName() {
						sessionCookie = cookie
					}
				}
				if sessionCookie == nil || !sessionCookie.HttpOnly || !sessionCookie.Secure || sessionCookie.MaxAge != 3600 || sessionCookie.SameSite != http.SameSiteLaxMode {
					t.Fatal("missing or unsafe session cookie")
				}
				var session loginSession
				if !auth.verify("session", sessionCookie.Value, &session) || session.User.ID != 42 || session.User.Login != "alice" || session.CSRF == "" {
					t.Fatal("invalid login session")
				}
				decoded, _ := base64.RawURLEncoding.DecodeString(strings.Split(sessionCookie.Value, ".")[0])
				if strings.Contains(string(decoded), "private-github-token") || strings.Contains(string(decoded), "test-secret") {
					t.Fatal("provider credentials leaked into session")
				}
				rec = authRequest(handler, "GET", "/api/state", "", []*http.Cookie{sessionCookie}, "", "")
				if rec.Code != 200 {
					t.Fatal("OAuth session cannot open workspace")
				}
			} else {
				for _, cookie := range rec.Result().Cookies() {
					if cookie.Name == auth.cookieName() && cookie.MaxAge > 0 {
						t.Fatal("failed authorization issued a session")
					}
				}
			}
		})
	}
}

func TestGitHubOAuthRejectsInvalidState(t *testing.T) {
	auth := testGitHubAuth(t)
	handler := authHandler(auth)
	valid := oauthState{State: "correct", Verifier: "verifier", Expires: time.Now().Add(time.Minute).Unix()}
	values := []string{"forged"}
	for _, state := range []oauthState{
		{State: "correct", Verifier: "verifier", Expires: time.Now().Add(-time.Minute).Unix()},
		{State: "correct", Verifier: "verifier", Expires: time.Now().Add(time.Hour).Unix()},
		{State: "different", Verifier: "verifier", Expires: valid.Expires},
		{State: "correct", Expires: valid.Expires},
	} {
		data, err := json.Marshal(state)
		if err != nil {
			t.Fatal(err)
		}
		values = append(values, auth.sign("oauth", data))
	}
	for _, value := range values {
		rec := authRequest(handler, "GET", "/auth/github/callback?code=valid&state=correct", "", []*http.Cookie{{Name: "odee_oauth", Value: value}}, "", "")
		if rec.Code != 400 {
			t.Fatalf("invalid OAuth state accepted: %d", rec.Code)
		}
	}
	data, _ := json.Marshal(valid)
	cookie := &http.Cookie{Name: "odee_oauth", Value: auth.sign("oauth", data)}
	for _, query := range []string{"state=correct", "state=correct&code=valid&error=access_denied"} {
		if rec := authRequest(handler, "GET", "/auth/github/callback?"+query, "", []*http.Cookie{cookie}, "", ""); rec.Code != 400 {
			t.Fatal("cancelled or missing-code callback accepted")
		}
	}
	if rec := authRequest(handler, "GET", "/auth/github/callback?code=valid&state=correct", "", nil, "", ""); rec.Code != 400 {
		t.Fatal("callback accepted without browser state cookie")
	}
	var session loginSession
	if auth.verify("session", cookie.Value, &session) {
		t.Fatal("OAuth state signature reused as a session")
	}
}

func TestGitHubLoopbackCookies(t *testing.T) {
	auth := testGitHubAuth(t)
	auth.config.Origin = "http://127.0.0.1:8098"
	login := authRequest(authHandler(auth), "GET", "http://127.0.0.1:8098/auth/github", "", nil, "", "")
	if auth.cookieName() != "odee_session" || login.Result().Cookies()[0].Secure {
		t.Fatal("loopback cookies cannot be used over local HTTP")
	}
}

func TestGitHubLoginUsesCanonicalCookieHost(t *testing.T) {
	auth := testGitHubAuth(t)
	auth.config.Origin = "http://127.0.0.1:8098"
	handler := authHandler(auth)
	rec := authRequest(handler, "GET", "http://localhost:8098/auth/github", "", nil, "", "")
	if rec.Code != 302 || rec.Header().Get("Location") != auth.config.Origin+"/auth/github" || len(rec.Result().Cookies()) != 0 {
		t.Fatal("alias host must redirect before creating the OAuth state cookie")
	}
	rec = authRequest(handler, "GET", auth.config.Origin+"/auth/github", "", nil, "", "")
	target, err := url.Parse(rec.Header().Get("Location"))
	if err != nil || target.Host != "github.com" || target.Query().Get("redirect_uri") != auth.config.Origin+"/auth/github/callback" || len(rec.Result().Cookies()) != 1 {
		t.Fatal("canonical origin did not start OAuth with a same-host callback cookie")
	}
}
