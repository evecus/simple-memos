package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type Store struct {
	db      *sql.DB
	dataDir string
}

type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	PasswordHash string `json:"-"`
	CreatedAt    int64  `json:"created_at"`
}

type Memo struct {
	ID         string   `json:"id"`
	Content    string   `json:"content"`
	Pinned     bool     `json:"pinned"`
	Archived   bool     `json:"archived"`
	Tags       []string `json:"tags"`
	CreatedAt  int64    `json:"created_at"`
	UpdatedAt  int64    `json:"updated_at"`
	Attachment []Attachment `json:"attachments,omitempty"`
}

type Attachment struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	MIME      string `json:"mime"`
	Size      int64  `json:"size"`
	MemoID    string `json:"memo_id,omitempty"`
	CreatedAt int64  `json:"created_at"`
	URL       string `json:"url,omitempty"`
}

func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "attachments"), 0o755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(dataDir, "memos.db")
	db, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)

	s := &Store{db: db, dataDir: dataDir}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) DataDir() string { return s.dataDir }

func (s *Store) AttachmentsDir() string {
	return filepath.Join(s.dataDir, "attachments")
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  memo_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(memo_id) REFERENCES memos(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_memos_created ON memos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memos_pinned ON memos(pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_memo ON attachments(memo_id);
`)
	return err
}

func (s *Store) NeedsSetup() (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	if err != nil {
		return false, err
	}
	return n == 0, nil
}

func (s *Store) CreateUser(username, displayName, passwordHash string) (*User, error) {
	u := &User{
		ID:           uuid.NewString(),
		Username:     username,
		DisplayName:  displayName,
		PasswordHash: passwordHash,
		CreatedAt:    time.Now().Unix(),
	}
	if u.DisplayName == "" {
		u.DisplayName = username
	}
	_, err := s.db.Exec(
		`INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
		u.ID, u.Username, u.DisplayName, u.PasswordHash, u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Store) GetUserByUsername(username string) (*User, error) {
	u := &User{}
	err := s.db.QueryRow(
		`SELECT id, username, display_name, password_hash, created_at FROM users WHERE username = ?`,
		username,
	).Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Store) GetUser(id string) (*User, error) {
	u := &User{}
	err := s.db.QueryRow(
		`SELECT id, username, display_name, password_hash, created_at FROM users WHERE id = ?`,
		id,
	).Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Store) CreateSession(userID string, ttl time.Duration) (token string, expiresAt int64, err error) {
	token = uuid.NewString() + uuid.NewString()
	expiresAt = time.Now().Add(ttl).Unix()
	_, err = s.db.Exec(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`, token, userID, expiresAt)
	return
}

func (s *Store) GetSessionUser(token string) (*User, error) {
	if token == "" {
		return nil, nil
	}
	var userID string
	var exp int64
	err := s.db.QueryRow(`SELECT user_id, expires_at FROM sessions WHERE token = ?`, token).Scan(&userID, &exp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if time.Now().Unix() > exp {
		_, _ = s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
		return nil, nil
	}
	return s.GetUser(userID)
}

func (s *Store) DeleteSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	return err
}

func ExtractTags(content string) []string {
	seen := map[string]struct{}{}
	var tags []string
	for _, part := range strings.Fields(content) {
		if !strings.HasPrefix(part, "#") {
			continue
		}
		t := strings.TrimLeft(part, "#")
		t = strings.Trim(t, ".,;:!?()[]{}\"'")
		if t == "" {
			continue
		}
		lower := strings.ToLower(t)
		if _, ok := seen[lower]; ok {
			continue
		}
		seen[lower] = struct{}{}
		tags = append(tags, t)
	}
	return tags
}

func (s *Store) CreateMemo(content string, pinned bool) (*Memo, error) {
	now := time.Now().Unix()
	m := &Memo{
		ID:        uuid.NewString(),
		Content:   content,
		Pinned:    pinned,
		Tags:      ExtractTags(content),
		CreatedAt: now,
		UpdatedAt: now,
	}
	_, err := s.db.Exec(
		`INSERT INTO memos (id, content, pinned, archived, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
		m.ID, m.Content, boolToInt(m.Pinned), m.CreatedAt, m.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (s *Store) UpdateMemo(id, content string, pinned, archived *bool) (*Memo, error) {
	m, err := s.GetMemo(id)
	if err != nil || m == nil {
		return m, err
	}
	m.Content = content
	if pinned != nil {
		m.Pinned = *pinned
	}
	if archived != nil {
		m.Archived = *archived
	}
	m.Tags = ExtractTags(m.Content)
	m.UpdatedAt = time.Now().Unix()
	_, err = s.db.Exec(
		`UPDATE memos SET content = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ?`,
		m.Content, boolToInt(m.Pinned), boolToInt(m.Archived), m.UpdatedAt, id,
	)
	if err != nil {
		return nil, err
	}
	atts, _ := s.ListAttachmentsByMemo(id)
	m.Attachment = atts
	return m, nil
}

func (s *Store) DeleteMemo(id string) error {
	atts, _ := s.ListAttachmentsByMemo(id)
	for _, a := range atts {
		_ = s.DeleteAttachment(a.ID)
	}
	_, err := s.db.Exec(`DELETE FROM memos WHERE id = ?`, id)
	return err
}

func (s *Store) GetMemo(id string) (*Memo, error) {
	m := &Memo{}
	var pinned, archived int
	err := s.db.QueryRow(
		`SELECT id, content, pinned, archived, created_at, updated_at FROM memos WHERE id = ?`, id,
	).Scan(&m.ID, &m.Content, &pinned, &archived, &m.CreatedAt, &m.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	m.Pinned = pinned != 0
	m.Archived = archived != 0
	m.Tags = ExtractTags(m.Content)
	atts, _ := s.ListAttachmentsByMemo(id)
	m.Attachment = atts
	return m, nil
}

type ListMemosOpts struct {
	Archived bool
	Tag      string
	Limit    int
	Offset   int
}

func (s *Store) ListMemos(opts ListMemosOpts) ([]*Memo, error) {
	if opts.Limit <= 0 {
		opts.Limit = 50
	}
	rows, err := s.db.Query(
		`SELECT id, content, pinned, archived, created_at, updated_at FROM memos
		 WHERE archived = ?
		 ORDER BY pinned DESC, created_at DESC
		 LIMIT ? OFFSET ?`,
		boolToInt(opts.Archived), opts.Limit, opts.Offset,
	)
	if err != nil {
		return nil, err
	}

	var out []*Memo
	for rows.Next() {
		m := &Memo{}
		var pinned, archived int
		if err := rows.Scan(&m.ID, &m.Content, &pinned, &archived, &m.CreatedAt, &m.UpdatedAt); err != nil {
			_ = rows.Close()
			return nil, err
		}
		m.Pinned = pinned != 0
		m.Archived = archived != 0
		m.Tags = ExtractTags(m.Content)
		if opts.Tag != "" {
			found := false
			for _, t := range m.Tags {
				if strings.EqualFold(t, opts.Tag) {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	for _, m := range out {
		atts, err := s.ListAttachmentsByMemo(m.ID)
		if err != nil {
			return nil, err
		}
		m.Attachment = atts
	}
	return out, nil
}

func (s *Store) CreateAttachment(filename, mime string, size int64, data []byte) (*Attachment, error) {
	id := uuid.NewString()
	path := filepath.Join(s.AttachmentsDir(), id)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return nil, err
	}
	a := &Attachment{
		ID:        id,
		Filename:  filename,
		MIME:      mime,
		Size:      size,
		CreatedAt: time.Now().Unix(),
		URL:       "/api/attachments/" + id + "/file",
	}
	_, err := s.db.Exec(
		`INSERT INTO attachments (id, filename, mime, size, memo_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)`,
		a.ID, a.Filename, a.MIME, a.Size, a.CreatedAt,
	)
	if err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	return a, nil
}

func (s *Store) LinkAttachment(attachmentID, memoID string) error {
	res, err := s.db.Exec(`UPDATE attachments SET memo_id = ? WHERE id = ?`, memoID, attachmentID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("attachment not found")
	}
	return nil
}

func (s *Store) ListAttachmentsByMemo(memoID string) ([]Attachment, error) {
	rows, err := s.db.Query(
		`SELECT id, filename, mime, size, COALESCE(memo_id,''), created_at FROM attachments WHERE memo_id = ? ORDER BY created_at`,
		memoID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Attachment
	for rows.Next() {
		var a Attachment
		if err := rows.Scan(&a.ID, &a.Filename, &a.MIME, &a.Size, &a.MemoID, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.URL = "/api/attachments/" + a.ID + "/file"
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) GetAttachment(id string) (*Attachment, error) {
	a := &Attachment{}
	var memoID sql.NullString
	err := s.db.QueryRow(
		`SELECT id, filename, mime, size, memo_id, created_at FROM attachments WHERE id = ?`, id,
	).Scan(&a.ID, &a.Filename, &a.MIME, &a.Size, &memoID, &a.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if memoID.Valid {
		a.MemoID = memoID.String
	}
	a.URL = "/api/attachments/" + a.ID + "/file"
	return a, nil
}

func (s *Store) AttachmentPath(id string) string {
	return filepath.Join(s.AttachmentsDir(), id)
}

func (s *Store) DeleteAttachment(id string) error {
	_ = os.Remove(s.AttachmentPath(id))
	_, err := s.db.Exec(`DELETE FROM attachments WHERE id = ?`, id)
	return err
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
