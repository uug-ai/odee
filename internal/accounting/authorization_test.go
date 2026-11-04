package accounting

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

var protectedRoutes = []struct {
	method, path string
	required     []Capability
}{
	{"GET", "/api/state", []Capability{Read}},
	{"GET", "/api/company-profile", []Capability{Read}},
	{"PUT", "/api/company-profile", []Capability{Read, Admin}},
	{"GET", "/api/contacts", []Capability{Read}},
	{"POST", "/api/contacts", []Capability{Read, Write}},
	{"PUT", "/api/contacts/000000000000000000000002", []Capability{Read, Write}},
	{"POST", "/api/contacts/import", []Capability{Read, Write}},
	{"POST", "/api/documents", []Capability{Read, Write}},
	{"PUT", "/api/documents/000000000000000000000002", []Capability{Read, Write}},
	{"POST", "/api/documents/000000000000000000000002/post", []Capability{Read, Post}},
	{"POST", "/api/documents/000000000000000000000002/payments", []Capability{Read, Post}},
	{"GET", "/api/documents/000000000000000000000002/audit", []Capability{Read, Admin}},
	{"POST", "/api/imports", []Capability{Read, Write}},
	{"GET", "/api/imports/000000000000000000000002", []Capability{Read}},
	{"GET", "/api/imports/000000000000000000000002/original", []Capability{Read}},
	{"GET", "/api/imports/000000000000000000000002/preview", []Capability{Read}},
	{"POST", "/api/imports/000000000000000000000002/scan", []Capability{Read, Write}},
	{"POST", "/api/imports/000000000000000000000002/draft", []Capability{Read, Write}},
}

func testPolicy(t *testing.T, mode, principal string, company primitive.ObjectID, caps []Capability) *Authorization {
	t.Helper()
	raw, err := json.Marshal([]Grant{{Principal: principal, CompanyID: company, Capabilities: caps}})
	if err != nil {
		t.Fatal(err)
	}
	policy, err := ParseAuthorization(mode, string(raw))
	if err != nil {
		t.Fatal(err)
	}
	return policy
}

func TestAuthorizationConfiguration(t *testing.T) {
	for _, principal := range []string{"github:42", "token:company", "development:local"} {
		p := testPolicy(t, "enforced", principal, testCompany, []Capability{})
		if !p.access(principal, testCompany).Member {
			t.Fatal("empty explicit capability set must still be a membership")
		}
	}
	for _, principal := range []string{"", "alice", "github:alice", "github:0", "github:-1", "github:+42", "github:042", "github:9223372036854775808", "token:person", "development:admin"} {
		t.Run("invalid-"+principal, func(t *testing.T) {
			raw := fmt.Sprintf(`[{"principal":%q,"companyId":%q,"capabilities":["read"]}]`, principal, testCompany.Hex())
			if _, err := ParseAuthorization("", raw); err == nil {
				t.Fatal("invalid principal accepted")
			}
		})
	}
	for _, raw := range []string{
		`null`, `{}`, `[] []`, `[{"principal":"token:company","companyId":"bad","capabilities":[]}]`,
		`[{"principal":"token:company","companyId":"000000000000000000000000","capabilities":[]}]`,
		fmt.Sprintf(`[{"principal":"token:company","companyId":%q}]`, testCompany.Hex()),
		fmt.Sprintf(`[{"principal":"token:company","companyId":%q,"capabilities":["owner"]}]`, testCompany.Hex()),
		fmt.Sprintf(`[{"principal":"token:company","companyId":%q,"capabilities":["read","read"]}]`, testCompany.Hex()),
		fmt.Sprintf(`[{"principal":"token:company","companyId":%q,"capabilities":[],"admin":true}]`, testCompany.Hex()),
		fmt.Sprintf(`[{"principal":"token:company","companyId":%q,"capabilities":["read"]},{"principal":"token:company","companyId":%q,"capabilities":["post"]}]`, testCompany.Hex(), testCompany.Hex()),
	} {
		if _, err := ParseAuthorization("", raw); err == nil {
			t.Fatalf("invalid grants accepted: %s", raw)
		}
	}
	if _, err := ParseAuthorization("automatic", "[]"); err == nil {
		t.Fatal("unknown mode accepted")
	}
	raw := fmt.Sprintf(`[{"principal":"token:company","companyId":%q,"capabilities":["read","post"]},{"principal":"token:company","companyId":%q,"capabilities":["post","read"]}]`, testCompany.Hex(), testCompany.Hex())
	if _, err := ParseAuthorization("", raw); err != nil {
		t.Fatal("identical duplicate rejected", err)
	}
}

func authorizationServer(t *testing.T, mode string) (*Server, func(string, string, string, bool, bool) *httptest.ResponseRecorder) {
	t.Helper()
	s := &Server{
		Company: testCompany, Store: NewMemoryStore(), Contacts: NewMemoryContacts(testCompany),
		Imports: NewMemoryImports(testCompany), Origin: "https://odee.example", Token: strings.Repeat("t", 32),
		Profiles: NewMemoryCompany(testCompany),
	}
	if mode == "github" {
		s.Auth = testGitHubAuth(t)
	} else if mode == "development" {
		s.Dev = true
	}
	handler := s.Handler()
	mux := http.NewServeMux()
	mux.Handle("/api/", handler)
	s.RegisterAuthentication(mux)
	return s, func(method, path, body string, authenticated, verified bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if path == "/api/imports" {
			r.Header.Set("Content-Type", "multipart/form-data; boundary=synthetic")
		}
		if verified {
			r.Header.Set("Origin", s.Origin)
			r.Header.Set("X-CSRF-Token", "test-csrf")
		}
		if authenticated {
			r.Header.Set("Authorization", "Bearer "+s.Token)
			if s.Auth != nil {
				r.AddCookie(authCookie(t, s.Auth, time.Now().Add(30*time.Minute)))
			}
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
}

func TestAuthorizationEveryRouteAllSetsAndModes(t *testing.T) {
	for _, mode := range []string{"github", "token", "development"} {
		for _, policyMode := range []string{"compatibility", "enforced"} {
			for mask := 0; mask < 19; mask++ {
				t.Run(fmt.Sprintf("%s/%s/set-%d", mode, policyMode, mask), func(t *testing.T) {
					s, request := authorizationServer(t, mode)
					principal := map[string]string{"github": "github:42", "token": "token:company", "development": "development:local"}[mode]
					caps := []Capability{}
					company := testCompany
					if mask < 16 {
						for bit, capability := range []Capability{Read, Write, Post, Admin} {
							if mask&(1<<bit) != 0 {
								caps = append(caps, capability)
							}
						}
						s.Authorization = testPolicy(t, policyMode, principal, company, caps)
					} else if mask == 16 {
						s.Authorization = testPolicy(t, policyMode, principal, primitive.NewObjectID(), []Capability{Read, Write, Post, Admin})
					} else if mask == 17 {
						s.Authorization, _ = ParseAuthorization(policyMode, "[]")
					} else {
						s.Authorization = testPolicy(t, policyMode, "github:99", company, []Capability{Admin})
					}
					expectedMember := mask < 16 || mask > 16 && policyMode == "compatibility"
					if mask > 16 && expectedMember {
						caps = []Capability{Read, Write, Post}
					}
					for _, route := range protectedRoutes {
						t.Run(route.method+route.path, func(t *testing.T) {
							response := request(route.method, route.path, `{}`, true, true)
							allowed := expectedMember
							for _, required := range route.required {
								has := false
								for _, capability := range caps {
									has = has || capability == required
								}
								allowed = allowed && has
							}
							if allowed {
								if response.Code == 401 || response.Code == 403 || response.Code >= 500 && response.Code != 503 {
									t.Fatalf("allowed route rejected: %d %s", response.Code, response.Body)
								}
							} else if response.Code != 403 || !strings.Contains(response.Body.String(), "administrator") {
								t.Fatalf("expected actionable 403, got %d %s", response.Code, response.Body)
							}
						})
					}
					response := request("GET", "/api/session", "", true, true)
					var discovery struct {
						Authenticated bool   `json:"authenticated"`
						Access        Access `json:"access"`
					}
					if err := json.Unmarshal(response.Body.Bytes(), &discovery); err != nil ||
						!discovery.Authenticated || discovery.Access.Principal != principal ||
						discovery.Access.Mode != policyMode || discovery.Access.Member != expectedMember ||
						fmt.Sprint(discovery.Access.Capabilities) != fmt.Sprint(caps) ||
						strings.Contains(response.Body.String(), "github:99") {
						t.Fatalf("discovery leaks or loses current access: %s %v", response.Body, err)
					}
				})
			}
		}
	}
}

func TestAuthorizationEveryRouteAuthenticationAndVerification(t *testing.T) {
	for _, mode := range []string{"github", "token", "development"} {
		s, request := authorizationServer(t, mode)
		for _, route := range protectedRoutes {
			t.Run(mode+route.method+route.path, func(t *testing.T) {
				if mode != "development" {
					if w := request(route.method, route.path, `{}`, false, true); w.Code != 401 {
						t.Fatalf("missing authentication: %d %s", w.Code, w.Body)
					}
				}
				if route.method != "GET" {
					if w := request(route.method, route.path, `{}`, true, false); w.Code != 403 {
						t.Fatalf("origin/CSRF missing: %d %s", w.Code, w.Body)
					}
					if s.Auth != nil {
						for _, verification := range []struct{ origin, csrf string }{
							{s.Origin, ""}, {s.Origin, "wrong-csrf"},
							{"https://foreign.example.invalid", "test-csrf"}, {"", "test-csrf"},
						} {
							r := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
							r.Header.Set("Origin", verification.origin)
							r.Header.Set("X-CSRF-Token", verification.csrf)
							r.Header.Set("Content-Type", "application/json")
							r.AddCookie(authCookie(t, s.Auth, time.Now().Add(30*time.Minute)))
							w := httptest.NewRecorder()
							s.Handler().ServeHTTP(w, r)
							if w.Code != 403 {
								t.Fatal("origin or CSRF bypass", verification, w.Code)
							}
						}
					}
				}
				if s.Auth != nil {
					for _, expires := range []time.Time{time.Now().Add(-time.Minute), time.Now().Add(2 * time.Hour)} {
						r := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
						r.AddCookie(authCookie(t, s.Auth, expires))
						r.Header.Set("Authorization", "Bearer "+s.Token)
						w := httptest.NewRecorder()
						s.Handler().ServeHTTP(w, r)
						if w.Code != 401 {
							t.Fatal("expired/invalid cookie or token bypassed GitHub")
						}
					}
					for _, id := range []int64{0, -1} {
						data, err := json.Marshal(loginSession{
							User: GitHubUser{ID: id, Login: "admin"}, CSRF: "test-csrf",
							Expires: time.Now().Add(30 * time.Minute).Unix(),
						})
						if err != nil {
							t.Fatal(err)
						}
						r := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
						r.AddCookie(&http.Cookie{Name: s.Auth.cookieName(), Value: s.Auth.sign("session", data)})
						r.Header.Set("Authorization", "Bearer "+s.Token)
						w := httptest.NewRecorder()
						s.Handler().ServeHTTP(w, r)
						if w.Code != 401 {
							t.Fatal("invalid numeric principal bypassed authentication", id, w.Code)
						}
					}
				} else if !s.Dev {
					if w := apiRequest(s.Handler(), route.method, route.path, `{}`, "bad", s.Origin); w.Code != 401 {
						t.Fatal("invalid token accepted")
					}
				}
			})
		}
	}
}
