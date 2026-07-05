// Package meta is the app metadata store (design §5): saved connections
// (secrets stripped), query history, window layout. Backed by SQLite
// (modernc.org/sqlite, cgo-free).
package meta

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"datagrid/internal/drivers"
)

// Store persists app metadata in a local SQLite database.
type Store struct {
	db *sql.DB
}

// DefaultPath returns the SQLite path under the user's Application Support.
func DefaultPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, "Library", "Application Support", "DataGrid")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return filepath.Join(dir, "meta.db"), nil
}

// Open opens (and migrates) the metadata store at path.
// An empty path uses DefaultPath.
func Open(path string) (*Store, error) {
	if path == "" {
		p, err := DefaultPath()
		if err != nil {
			return nil, err
		}
		path = p
	}
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	// A single writer is plenty for app metadata and sidesteps SQLITE_BUSY.
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS connections (
    id         TEXT PRIMARY KEY,
    config     TEXT NOT NULL,             -- ConnectionConfig JSON, no secrets
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    conn_id     TEXT NOT NULL,
    statement   TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    row_count   INTEGER NOT NULL,
    error       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS history_conn_time ON history(conn_id, started_at);
`)
	return err
}

// SaveConnection inserts or updates a connection config.
func (s *Store) SaveConnection(cfg drivers.ConnectionConfig) error {
	blob, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = s.db.Exec(`
INSERT INTO connections (id, config, created_at, updated_at) VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
		cfg.ID, string(blob), now, now)
	return err
}

// DeleteConnection removes a connection config.
func (s *Store) DeleteConnection(id string) error {
	_, err := s.db.Exec(`DELETE FROM connections WHERE id = ?`, id)
	return err
}

// Connections returns all saved connection configs (secrets are never here).
func (s *Store) Connections() ([]drivers.ConnectionConfig, error) {
	rows, err := s.db.Query(`SELECT config FROM connections ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []drivers.ConnectionConfig{}
	for rows.Next() {
		var blob string
		if err := rows.Scan(&blob); err != nil {
			return nil, err
		}
		var cfg drivers.ConnectionConfig
		if err := json.Unmarshal([]byte(blob), &cfg); err != nil {
			return nil, fmt.Errorf("corrupt connection row: %w", err)
		}
		out = append(out, cfg)
	}
	return out, rows.Err()
}

// HistoryEntry is one recorded statement execution.
type HistoryEntry struct {
	ID         int64  `json:"id"`
	ConnID     string `json:"connId"`
	Statement  string `json:"statement"`
	StartedAt  string `json:"startedAt"`
	DurationMs int64  `json:"durationMs"`
	RowCount   int64  `json:"rowCount"`
	Error      string `json:"error"`
}

// History returns recent entries, newest first. A non-empty search filters
// by statement substring. connID empty means all connections.
func (s *Store) History(connID, search string, limit int) ([]HistoryEntry, error) {
	if limit <= 0 {
		limit = 200
	}
	q := `SELECT id, conn_id, statement, started_at, duration_ms, row_count, error FROM history`
	var conds []string
	var args []any
	if connID != "" {
		conds = append(conds, "conn_id = ?")
		args = append(args, connID)
	}
	if search != "" {
		conds = append(conds, "statement LIKE ?")
		args = append(args, "%"+search+"%")
	}
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	q += " ORDER BY id DESC LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HistoryEntry{}
	for rows.Next() {
		var e HistoryEntry
		if err := rows.Scan(&e.ID, &e.ConnID, &e.Statement, &e.StartedAt, &e.DurationMs, &e.RowCount, &e.Error); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// RecordHistory appends one executed statement to the query history.
func (s *Store) RecordHistory(connID, statement string, startedAt time.Time, duration time.Duration, rowCount int64, execErr string) error {
	_, err := s.db.Exec(`
INSERT INTO history (conn_id, statement, started_at, duration_ms, row_count, error)
VALUES (?, ?, ?, ?, ?, ?)`,
		connID, statement, startedAt.UTC().Format(time.RFC3339), duration.Milliseconds(), rowCount, execErr)
	return err
}

// Close releases the store.
func (s *Store) Close() error {
	return s.db.Close()
}
