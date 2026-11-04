package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func registerWeb(mux *http.ServeMux, dist string) http.Handler {
	mux.Handle("GET /assets/", http.FileServer(http.Dir(dist)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, prefix := range []string{"/api", "/auth", "/assets", "/healthz"} {
			if r.URL.Path == prefix || strings.HasPrefix(r.URL.Path, prefix+"/") {
				mux.ServeHTTP(w, r)
				return
			}
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		index, err := os.Open(filepath.Join(dist, "index.html"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer index.Close()
		info, err := index.Stat()
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, "index.html", info.ModTime(), index)
	})
}
