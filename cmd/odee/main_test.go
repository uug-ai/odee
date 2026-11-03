package main

import (
	"strings"
	"testing"
)

func TestAuthenticationStartupFailsClosed(t *testing.T) {
	for _, test := range []struct {
		name string
		env  map[string]string
		want string
	}{
		{"unknown mode", map[string]string{"ODEE_AUTH_MODE": "none"}, "ODEE_AUTH_MODE must be github or token"},
		{"github development bypass", map[string]string{"ODEE_AUTH_MODE": "github", "ODEE_DEV_MODE": "true"}, "disable ODEE_DEV_MODE"},
		{"github credentials missing", map[string]string{"ODEE_AUTH_MODE": "github"}, "GitHub authentication requires GITHUB_CLIENT_ID"},
		{"github session key missing", map[string]string{"ODEE_AUTH_MODE": "github", "GITHUB_CLIENT_ID": "client", "GITHUB_CLIENT_SECRET": "secret", "GITHUB_TEAM": "engineering"}, "SESSION_SECRET"},
		{"token missing", map[string]string{"ODEE_AUTH_MODE": "token"}, "set ODEE_API_TOKEN"},
		{"token short", map[string]string{"ODEE_API_TOKEN": "short"}, "set ODEE_API_TOKEN"},
		{"public development listener", map[string]string{"ODEE_DEV_MODE": "true", "ODEE_ADDR": "0.0.0.0:8098"}, "development mode must bind to a loopback IP"},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, key := range []string{"ODEE_AUTH_MODE", "ODEE_DEV_MODE", "ODEE_DEMO", "ODEE_API_TOKEN", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_TEAM", "SESSION_SECRET"} {
				t.Setenv(key, "")
			}
			t.Setenv("ODEE_ADDR", "127.0.0.1:8098")
			t.Setenv("ODEE_ORIGIN", "http://localhost:8098")
			t.Setenv("GITHUB_ORG", "uug-ai")
			for key, value := range test.env {
				t.Setenv(key, value)
			}
			if err := run(); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("startup error = %v; want %q", err, test.want)
			}
		})
	}
}
