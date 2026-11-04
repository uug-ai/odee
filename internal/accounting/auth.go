package accounting

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type AuthConfig struct {
	Origin       string
	ClientID     string
	ClientSecret string
	Organisation string
	Team         string
	SessionKey   string
}

func (c AuthConfig) Validate() error {
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("GitHub authentication requires an absolute ODEE_ORIGIN without a path")
	}
	loopback := u.Hostname() == "localhost" || net.ParseIP(u.Hostname()) != nil && net.ParseIP(u.Hostname()).IsLoopback()
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return fmt.Errorf("GitHub authentication requires HTTPS except on loopback")
	}
	if c.ClientID == "" || c.ClientSecret == "" || c.Organisation == "" || c.Team == "" {
		return fmt.Errorf("GitHub authentication requires GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_ORG and GITHUB_TEAM")
	}
	for _, slug := range []string{c.Organisation, c.Team} {
		for _, char := range slug {
			if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-') {
				return fmt.Errorf("GitHub organisation and team must be URL-safe slugs")
			}
		}
	}
	if len(c.SessionKey) < 32 {
		return fmt.Errorf("SESSION_SECRET must contain at least 32 characters")
	}
	return nil
}

type GitHubUser struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
	Name  string `json:"name"`
}

type loginSession struct {
	User    GitHubUser `json:"user"`
	CSRF    string     `json:"csrf"`
	Expires int64      `json:"expires"`
}

type oauthState struct {
	State    string `json:"state"`
	Verifier string `json:"verifier"`
	Expires  int64  `json:"expires"`
	ReturnTo string `json:"returnTo,omitempty"`
}

type GitHubAuth struct {
	config   AuthConfig
	client   *http.Client
	oauthURL string
	apiURL   string
}

func NewGitHubAuth(config AuthConfig) (*GitHubAuth, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	return &GitHubAuth{
		config: config,
		client: &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		}},
		oauthURL: "https://github.com/login/oauth/access_token",
		apiURL:   "https://api.github.com",
	}, nil
}

func authRandomToken() (string, error) {
	var value [32]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value[:]), nil
}

func (a *GitHubAuth) sign(purpose string, data []byte) string {
	value := base64.RawURLEncoding.EncodeToString(data)
	mac := hmac.New(sha256.New, []byte(a.config.SessionKey))
	// Bind signatures to this application, origin, access policy and cookie purpose.
	mac.Write([]byte("odee:" + a.config.Origin + ":" + a.config.Organisation + ":" + a.config.Team + ":" + purpose + ":" + value))
	return value + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *GitHubAuth) verify(purpose, value string, target any) bool {
	if len(value) > 4096 {
		return false
	}
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return false
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	return err == nil && hmac.Equal([]byte(a.sign(purpose, data)), []byte(value)) && json.Unmarshal(data, target) == nil
}

func (a *GitHubAuth) cookieName() string {
	if strings.HasPrefix(a.config.Origin, "https://") {
		return "__Host-odee_session"
	}
	return "odee_session"
}

func (a *GitHubAuth) setCookie(w http.ResponseWriter, name, value, path string, age int) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: path, MaxAge: age,
		HttpOnly: true, Secure: strings.HasPrefix(a.config.Origin, "https://"),
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *GitHubAuth) readSession(r *http.Request) (loginSession, bool) {
	cookie, err := r.Cookie(a.cookieName())
	var session loginSession
	if err != nil || !a.verify("session", cookie.Value, &session) || session.Expires <= time.Now().Unix() ||
		session.Expires > time.Now().Add(time.Hour).Unix() || session.CSRF == "" || session.User.ID <= 0 || session.User.Login == "" {
		return loginSession{}, false
	}
	return session, true
}

func (a *GitHubAuth) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /auth/github", a.login)
	mux.HandleFunc("GET /auth/github/callback", a.callback)
	mux.HandleFunc("GET /api/session", func(w http.ResponseWriter, r *http.Request) {
		session, ok := a.readSession(r)
		response := map[string]any{
			"authMode": "github", "authenticated": ok,
			"organisation": a.config.Organisation, "team": a.config.Team,
		}
		if ok {
			response["user"], response["csrfToken"] = session.User, session.CSRF
		}
		reply(w, http.StatusOK, response)
	})
	mux.HandleFunc("POST /api/logout", func(w http.ResponseWriter, r *http.Request) {
		if !a.Authorize(w, r) {
			return
		}
		a.setCookie(w, a.cookieName(), "", "/", -1)
		w.WriteHeader(http.StatusNoContent)
	})
}

func (a *GitHubAuth) Authorize(w http.ResponseWriter, r *http.Request) bool {
	session, ok := a.readSession(r)
	if !ok {
		reply(w, http.StatusUnauthorized, map[string]string{"error": "Sign in with GitHub to access this workspace."})
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead &&
		(r.Header.Get("Origin") != a.config.Origin || !hmac.Equal([]byte(r.Header.Get("X-CSRF-Token")), []byte(session.CSRF))) {
		reply(w, http.StatusForbidden, map[string]string{"error": "Request verification failed; reload and try again."})
		return false
	}
	return true
}

func (a *GitHubAuth) login(w http.ResponseWriter, r *http.Request) {
	state, err := authRandomToken()
	if err != nil {
		a.fail(w, err)
		return
	}
	verifier, err := authRandomToken()
	if err != nil {
		a.fail(w, err)
		return
	}
	data, err := json.Marshal(oauthState{
		State: state, Verifier: verifier, Expires: time.Now().Add(10 * time.Minute).Unix(),
		ReturnTo: a.returnPath(r.URL.Query().Get("returnTo")),
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	a.setCookie(w, "odee_oauth", a.sign("oauth", data), "/auth/github/callback", 600)
	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"client_id": {a.config.ClientID}, "redirect_uri": {a.config.Origin + "/auth/github/callback"},
		"scope": {"read:user read:org"}, "state": {state},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}, "code_challenge_method": {"S256"},
	}
	http.Redirect(w, r, "https://github.com/login/oauth/authorize?"+query.Encode(), http.StatusFound)
}

func (a *GitHubAuth) callback(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("odee_oauth")
	a.setCookie(w, "odee_oauth", "", "/auth/github/callback", -1)
	var state oauthState
	if err != nil || !a.verify("oauth", cookie.Value, &state) ||
		state.Expires <= time.Now().Unix() || state.Expires > time.Now().Add(10*time.Minute).Unix() ||
		state.State == "" || state.Verifier == "" || !hmac.Equal([]byte(state.State), []byte(r.URL.Query().Get("state"))) ||
		r.URL.Query().Get("code") == "" || r.URL.Query().Get("error") != "" {
		reply(w, http.StatusBadRequest, map[string]string{"error": "GitHub sign-in expired, was cancelled or its state was invalid; please try again."})
		return
	}
	user, err := a.githubUser(r.Context(), r.URL.Query().Get("code"), state.Verifier)
	if errors.Is(err, errGitHubNotMember) {
		reply(w, http.StatusForbidden, map[string]string{"error": "Access requires active membership of the configured GitHub team. If applicable, authorize your organisation's SSO and try again."})
		return
	}
	if err != nil {
		a.fail(w, err)
		return
	}
	csrf, err := authRandomToken()
	if err != nil {
		a.fail(w, err)
		return
	}
	data, err := json.Marshal(loginSession{User: user, CSRF: csrf, Expires: time.Now().Add(time.Hour).Unix()})
	if err != nil {
		a.fail(w, err)
		return
	}
	a.setCookie(w, a.cookieName(), a.sign("session", data), "/", 3600)
	http.Redirect(w, r, a.returnPath(state.ReturnTo), http.StatusSeeOther)
}

// Mirror the active web/src/modules.ts paths at the authentication trust boundary.
// The signed OAuth cookie, never a callback query parameter, carries the destination.
func (a *GitHubAuth) returnPath(destination string) string {
	u, err := url.Parse(destination)
	if err != nil || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" {
		return "/"
	}
	if u.IsAbs() {
		origin, err := url.Parse(a.config.Origin)
		if err != nil || u.Scheme != origin.Scheme || u.Host != origin.Host {
			return "/"
		}
	} else if u.Host != "" || !strings.HasPrefix(destination, "/") || strings.HasPrefix(destination, "//") {
		return "/"
	}
	switch u.Path {
	case "/", "/accounting", "/accounting/invoices", "/accounting/bills", "/accounting/journal",
		"/accounting/accounts", "/accounting/reports", "/contacts":
		return u.Path
	default:
		return "/"
	}
}

func (a *GitHubAuth) fail(w http.ResponseWriter, err error) {
	slog.Error("GitHub sign-in failed", "error", err)
	reply(w, http.StatusBadGateway, map[string]string{"error": "GitHub sign-in failed; check OAuth application access and try again."})
}

var errGitHubNotMember = errors.New("not an active GitHub team member")

func (a *GitHubAuth) githubUser(parent context.Context, code, verifier string) (GitHubUser, error) {
	ctx, cancel := context.WithTimeout(parent, 25*time.Second)
	defer cancel()
	form := url.Values{
		"client_id": {a.config.ClientID}, "client_secret": {a.config.ClientSecret}, "code": {code},
		"redirect_uri": {a.config.Origin + "/auth/github/callback"}, "code_verifier": {verifier},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.oauthURL, strings.NewReader(form.Encode()))
	if err != nil {
		return GitHubUser{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return GitHubUser{}, fmt.Errorf("exchange OAuth code: %w", err)
	}
	defer resp.Body.Close()
	var token struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&token) != nil || token.AccessToken == "" || token.Error != "" {
		return GitHubUser{}, errors.New("GitHub rejected OAuth token exchange")
	}
	get := func(path string, target any) (int, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.apiURL+path, nil)
		if err != nil {
			return 0, err
		}
		req.Header.Set("Authorization", "Bearer "+token.AccessToken)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		req.Header.Set("User-Agent", "uug-odee")
		resp, err := a.client.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return resp.StatusCode, nil
		}
		return resp.StatusCode, json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(target)
	}
	var user GitHubUser
	status, err := get("/user", &user)
	if err != nil || status != http.StatusOK || user.ID <= 0 || user.Login == "" || len(user.Login) > 100 || len(user.Name) > 200 {
		return GitHubUser{}, fmt.Errorf("GitHub profile unavailable (HTTP %d)", status)
	}
	var membership struct {
		State string `json:"state"`
	}
	path := "/orgs/" + a.config.Organisation + "/teams/" + a.config.Team + "/memberships/" + url.PathEscape(user.Login)
	status, err = get(path, &membership)
	if err != nil {
		return GitHubUser{}, fmt.Errorf("read GitHub team membership: %w", err)
	}
	if status == http.StatusNotFound || status == http.StatusOK && membership.State != "active" {
		return GitHubUser{}, errGitHubNotMember
	}
	if status != http.StatusOK {
		return GitHubUser{}, fmt.Errorf("GitHub team membership unavailable (HTTP %d)", status)
	}
	return user, nil
}
