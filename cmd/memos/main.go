package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/evecus/simple-memos/internal/api"
	"github.com/evecus/simple-memos/internal/config"
	"github.com/evecus/simple-memos/internal/store"
)

//go:embed static/*
var staticFS embed.FS

func main() {
	cfg, err := config.Parse()
	if err != nil {
		log.Fatal(err)
	}

	st, err := store.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	apiServer := api.New(st)

	webFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}

	fileServer := http.FileServer(http.FS(webFS))
	root := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			apiServer.Mux.ServeHTTP(w, r)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			serveFile(w, webFS, "index.html", "text/html; charset=utf-8")
			return
		}
		if _, err := fs.Stat(webFS, path); err != nil {
			serveFile(w, webFS, "index.html", "text/html; charset=utf-8")
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	fmt.Printf("simple-memos listening on http://%s\n", cfg.Addr)
	fmt.Printf("data directory: %s\n", cfg.DataDir)
	if needs, _ := st.NeedsSetup(); needs {
		fmt.Println("first run: open the URL and complete setup")
	}
	if err := http.ListenAndServe(cfg.Addr, root); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func serveFile(w http.ResponseWriter, fsys fs.FS, name, contentType string) {
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", contentType)
	_, _ = w.Write(data)
}
