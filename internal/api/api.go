package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/evecus/simple-memos/internal/auth"
	"github.com/evecus/simple-memos/internal/store"
)

type Server struct {
	Store *store.Store
	Mux   *http.ServeMux
}

func New(st *store.Store) *Server {
	s := &Server{Store: st, Mux: http.NewServeMux()}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.Mux.HandleFunc("GET /api/status", s.handleStatus)
	s.Mux.HandleFunc("POST /api/setup", s.handleSetup)
	s.Mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	s.Mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	s.Mux.HandleFunc("GET /api/auth/me", s.handleMe)
	s.Mux.HandleFunc("GET /api/memos", s.requireAuth(s.handleListMemos))
	s.Mux.HandleFunc("POST /api/memos", s.requireAuth(s.handleCreateMemo))
	s.Mux.HandleFunc("GET /api/memos/{id}", s.requireAuth(s.handleGetMemo))
	s.Mux.HandleFunc("PATCH /api/memos/{id}", s.requireAuth(s.handleUpdateMemo))
	s.Mux.HandleFunc("DELETE /api/memos/{id}", s.requireAuth(s.handleDeleteMemo))
	s.Mux.HandleFunc("POST /api/attachments", s.requireAuth(s.handleUploadAttachment))
	s.Mux.HandleFunc("POST /api/memos/{id}/attachments", s.requireAuth(s.handleLinkAttachments))
	s.Mux.HandleFunc("GET /api/attachments/{id}/file", s.handleAttachmentFile)
	s.Mux.HandleFunc("DELETE /api/attachments/{id}", s.requireAuth(s.handleDeleteAttachment))
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := auth.UserFromRequest(s.Store, r)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if u == nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	needs, err := s.Store.NeedsSetup()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	user, _ := auth.UserFromRequest(s.Store, r)
	writeJSON(w, http.StatusOK, map[string]any{"needs_setup": needs, "logged_in": user != nil, "version": "0.1.0"})
}

type setupReq struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	needs, err := s.Store.NeedsSetup()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !needs {
		writeErr(w, http.StatusBadRequest, "already set up")
		return
	}
	var req setupReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || len(req.Password) < 4 {
		writeErr(w, http.StatusBadRequest, "username required and password min 4 chars")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	u, err := s.Store.CreateUser(req.Username, req.DisplayName, hash)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	token, exp, err := s.Store.CreateSession(u.ID, auth.SessionTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	auth.SetSessionCookie(w, token, exp)
	writeJSON(w, http.StatusOK, map[string]any{"user": map[string]any{"id": u.ID, "username": u.Username, "display_name": u.DisplayName}})
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	u, err := s.Store.GetUserByUsername(strings.TrimSpace(req.Username))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if u == nil || !auth.CheckPassword(u.PasswordHash, req.Password) {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	token, exp, err := s.Store.CreateSession(u.ID, auth.SessionTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	auth.SetSessionCookie(w, token, exp)
	writeJSON(w, http.StatusOK, map[string]any{"user": map[string]any{"id": u.ID, "username": u.Username, "display_name": u.DisplayName}})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	tok := auth.TokenFromRequest(r)
	if tok != "" {
		_ = s.Store.DeleteSession(tok)
	}
	auth.ClearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, err := auth.UserFromRequest(s.Store, r)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": u.ID, "username": u.Username, "display_name": u.DisplayName})
}

func (s *Server) handleListMemos(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	archived := q.Get("archived") == "1" || q.Get("archived") == "true"
	tag := strings.TrimSpace(q.Get("tag"))
	list, err := s.Store.ListMemos(store.ListMemosOpts{Archived: archived, Tag: tag, Limit: limit, Offset: offset})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if list == nil {
		list = []*store.Memo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"memos": list})
}

type createMemoReq struct {
	Content       string   `json:"content"`
	Pinned        bool     `json:"pinned"`
	AttachmentIDs []string `json:"attachment_ids"`
}

func (s *Server) handleCreateMemo(w http.ResponseWriter, r *http.Request) {
	var req createMemoReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if strings.TrimSpace(req.Content) == "" && len(req.AttachmentIDs) == 0 {
		writeErr(w, http.StatusBadRequest, "content or attachments required")
		return
	}
	m, err := s.Store.CreateMemo(req.Content, req.Pinned)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, aid := range req.AttachmentIDs {
		_ = s.Store.LinkAttachment(aid, m.ID)
	}
	m, _ = s.Store.GetMemo(m.ID)
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) handleGetMemo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	m, err := s.Store.GetMemo(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m == nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, m)
}

type updateMemoReq struct {
	Content  *string `json:"content"`
	Pinned   *bool   `json:"pinned"`
	Archived *bool   `json:"archived"`
}

func (s *Server) handleUpdateMemo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := s.Store.GetMemo(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	var req updateMemoReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	content := existing.Content
	if req.Content != nil {
		content = *req.Content
	}
	m, err := s.Store.UpdateMemo(id, content, req.Pinned, req.Archived)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handleDeleteMemo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.Store.DeleteMemo(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	const maxSize = 32 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)
	if err := r.ParseMultipartForm(maxSize); err != nil {
		writeErr(w, http.StatusBadRequest, "file too large or invalid multipart")
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "file required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	mime := hdr.Header.Get("Content-Type")
	if mime == "" {
		mime = http.DetectContentType(data)
	}
	a, err := s.Store.CreateAttachment(hdr.Filename, mime, int64(len(data)), data)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

type linkAttReq struct {
	AttachmentIDs []string `json:"attachment_ids"`
}

func (s *Server) handleLinkAttachments(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	m, err := s.Store.GetMemo(id)
	if err != nil || m == nil {
		writeErr(w, http.StatusNotFound, "memo not found")
		return
	}
	var req linkAttReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	for _, aid := range req.AttachmentIDs {
		_ = s.Store.LinkAttachment(aid, id)
	}
	m, _ = s.Store.GetMemo(id)
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handleAttachmentFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a, err := s.Store.GetAttachment(id)
	if err != nil || a == nil {
		http.NotFound(w, r)
		return
	}
	u, _ := auth.UserFromRequest(s.Store, r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	path := s.Store.AttachmentPath(id)
	w.Header().Set("Content-Type", a.MIME)
	w.Header().Set("Content-Disposition", "inline; filename=\""+a.Filename+"\"")
	http.ServeFile(w, r, path)
}

func (s *Server) handleDeleteAttachment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.Store.DeleteAttachment(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}
