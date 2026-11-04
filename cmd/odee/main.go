package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/uug-ai/odee/internal/accounting"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func main() {
	if err := run(); err != nil {
		slog.Error("odee stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	addr := env("ODEE_ADDR", "127.0.0.1:8098")
	dev, demo := os.Getenv("ODEE_DEV_MODE") == "true", os.Getenv("ODEE_DEMO") == "true"
	token := os.Getenv("ODEE_API_TOKEN")
	authMode := env("ODEE_AUTH_MODE", "token")
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid ODEE_ADDR: %w", err)
	}
	if dev && (net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback()) {
		return fmt.Errorf("development mode must bind to a loopback IP")
	}
	if demo && !dev {
		return fmt.Errorf("temporary demo storage is only available in development mode")
	}
	origin := env("ODEE_ORIGIN", "http://"+addr)
	originURL, err := url.Parse(origin)
	if err != nil || originURL.Host == "" || (originURL.Scheme != "http" && originURL.Scheme != "https") || originURL.Path != "" || originURL.RawQuery != "" || originURL.Fragment != "" || originURL.User != nil {
		return fmt.Errorf("ODEE_ORIGIN must be an http(s) origin without a path")
	}
	var auth *accounting.GitHubAuth
	switch authMode {
	case "github":
		if dev {
			return fmt.Errorf("disable ODEE_DEV_MODE when using GitHub authentication")
		}
		auth, err = accounting.NewGitHubAuth(accounting.AuthConfig{
			Origin: origin, ClientID: os.Getenv("GITHUB_CLIENT_ID"), ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
			Organisation: env("GITHUB_ORG", "uug-ai"), Team: os.Getenv("GITHUB_TEAM"), SessionKey: os.Getenv("SESSION_SECRET"),
		})
		if err != nil {
			return err
		}
	case "token":
		if !dev && len(token) < 32 {
			return fmt.Errorf("set ODEE_API_TOKEN to at least 32 characters, or configure ODEE_AUTH_MODE=github")
		}
	default:
		return fmt.Errorf("ODEE_AUTH_MODE must be github or token")
	}
	company, err := primitive.ObjectIDFromHex(env("ODEE_COMPANY_ID", "000000000000000000000001"))
	if err != nil || company.IsZero() {
		return fmt.Errorf("ODEE_COMPANY_ID must be a nonzero BSON ObjectID")
	}
	authorization, err := accounting.ParseAuthorization(env("ODEE_AUTHZ_MODE", "compatibility"), os.Getenv("ODEE_CAPABILITY_GRANTS"))
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var store accounting.Store
	var imports accounting.ImportStore
	var contacts accounting.ContactStore
	if demo {
		store = accounting.NewMemoryStore()
		imports = accounting.NewMemoryImports(company)
		contacts = accounting.NewMemoryContacts(company)
		slog.Warn("DEMO MODE: temporary empty storage; all data is lost on restart")
	} else {
		uri := os.Getenv("MONGODB_URI")
		if uri == "" {
			return fmt.Errorf("MONGODB_URI is required; there is no automatic storage fallback")
		}
		startCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		mongoStore, err := accounting.OpenMongo(startCtx, uri, env("MONGODB_DATABASE_ODEE", "odee"), company)
		cancel()
		if err != nil {
			return err
		}
		defer func() {
			closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := mongoStore.Client.Disconnect(closeCtx); err != nil {
				slog.Error("MongoDB disconnect failed", "error", err)
			}
		}()
		contactCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		contacts, err = accounting.NewMongoContacts(contactCtx, mongoStore)
		cancel()
		if err != nil {
			return err
		}
		store = mongoStore
		imports, err = accounting.NewMongoImports(ctx, mongoStore)
		if err != nil {
			return err
		}
	}
	scanner := accounting.NewScanner(env("ODEE_OCR_LANGUAGES", "eng+nld+fra"))
	if err := scanner.Ready(); err != nil {
		slog.Warn("local bill scanning is unavailable", "error", err)
	}
	service := &accounting.Server{Store: store, Company: company, Name: env("ODEE_COMPANY_NAME", "My company"),
		Token: token, Origin: origin, Demo: demo, Dev: dev, Auth: auth, Authorization: authorization, Imports: imports, Scanner: scanner, Contacts: contacts}
	api := service.Handler()
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	service.RegisterAuthentication(mux)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("ok")); err != nil {
			slog.Error("write health response", "error", err)
		}
	})
	web := registerWeb(mux, env("ODEE_WEB_DIR", "web/dist"))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		if originURL.Scheme == "https" {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		web.ServeHTTP(w, r)
	})
	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 45 * time.Second, WriteTimeout: 210 * time.Second, IdleTimeout: 60 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	slog.Info("odee listening", "address", addr, "demo", demo, "development", dev, "auth", authMode)
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
	return nil
}
