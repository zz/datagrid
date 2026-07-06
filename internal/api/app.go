// Package api holds the Wails bound methods — the only surface the webview
// can call (design §8). Handlers stay thin; logic lives in the packages above.
package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"datagrid/internal/drivers"
	_ "datagrid/internal/drivers/mysql"    // register driver
	_ "datagrid/internal/drivers/postgres" // register driver
	_ "datagrid/internal/drivers/redis"    // register driver
	"datagrid/internal/meta"
	"datagrid/internal/secrets"
	"datagrid/internal/tunnel"
)

// Version is stamped at build time via -ldflags "-X datagrid/internal/api.Version=...".
var Version = "dev"

// Event names emitted to the frontend.
const (
	EvQueryBatch = "query:batch"
	EvQueryDone  = "query:done"
)

// App is the root bound struct exposed to the frontend.
type App struct {
	ctx     context.Context
	meta    *meta.Store
	secrets secrets.Store
	tunnels *tunnel.Manager

	mu       sync.Mutex
	sessions map[string]*openSession // by connection ID
}

type openSession struct {
	session drivers.Session
	cfg     drivers.ConnectionConfig
	release func() // tunnel lease release, if any
}

// NewApp wires the core services together.
func NewApp() (*App, error) {
	store, err := meta.Open("")
	if err != nil {
		return nil, err
	}
	return &App{
		meta:     store,
		secrets:  secrets.NewStore(),
		tunnels:  tunnel.NewManager(),
		sessions: map[string]*openSession{},
	}, nil
}

// Startup is called by Wails when the app starts; the context is kept for
// emitting runtime events (row batches).
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

// Shutdown is called by Wails on exit.
func (a *App) Shutdown(ctx context.Context) {
	a.mu.Lock()
	for id, os := range a.sessions {
		_ = os.session.Close()
		if os.release != nil {
			os.release()
		}
		delete(a.sessions, id)
	}
	a.mu.Unlock()
	a.tunnels.Close()
	_ = a.meta.Close()
}

// AppInfo is basic app metadata shown in the status bar / about box.
type AppInfo struct {
	Version string `json:"version"`
}

// GetAppInfo returns app metadata.
func (a *App) GetAppInfo() AppInfo {
	return AppInfo{Version: Version}
}

// Copy writes text to the system clipboard. Used so error messages and
// values are copyable even where the webview blocks text selection.
func (a *App) Copy(text string) error {
	return runtime.ClipboardSetText(a.ctx, text)
}

// --- Connections --------------------------------------------------------

func passwordRef(connID string) string { return "conn/" + connID + "/password" }

// ListConnections returns all saved connection configs (never secrets).
func (a *App) ListConnections() ([]drivers.ConnectionConfig, error) {
	return a.meta.Connections()
}

// SaveConnection saves a connection config; a non-empty password goes to
// the Keychain, never to the metadata store. Returns the config with its
// assigned ID.
func (a *App) SaveConnection(cfg drivers.ConnectionConfig, password string) (drivers.ConnectionConfig, error) {
	if cfg.ID == "" {
		var b [8]byte
		if _, err := rand.Read(b[:]); err != nil {
			return cfg, err
		}
		cfg.ID = hex.EncodeToString(b[:])
	}
	if err := a.meta.SaveConnection(cfg); err != nil {
		return cfg, err
	}
	if password != "" {
		if err := a.secrets.Set(passwordRef(cfg.ID), []byte(password)); err != nil {
			return cfg, fmt.Errorf("saved, but storing password in Keychain failed: %w", err)
		}
	}
	return cfg, nil
}

// DeleteConnection closes any open session and removes the config and its
// Keychain secret.
func (a *App) DeleteConnection(id string) error {
	_ = a.Disconnect(id)
	_ = a.secrets.Delete(passwordRef(id))
	return a.meta.DeleteConnection(id)
}

// TestConnection connects and pings with the given config. An empty
// password falls back to the one stored for cfg.ID.
func (a *App) TestConnection(cfg drivers.ConnectionConfig, password string) error {
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	sess, release, err := a.open(ctx, cfg, password)
	if err != nil {
		return err
	}
	defer func() {
		_ = sess.Close()
		if release != nil {
			release()
		}
	}()
	return sess.Ping(ctx)
}

// Connect opens (or reuses) a session for a saved connection.
func (a *App) Connect(connID string) error {
	a.mu.Lock()
	if _, ok := a.sessions[connID]; ok {
		a.mu.Unlock()
		return nil
	}
	a.mu.Unlock()

	cfg, err := a.config(connID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	sess, release, err := a.open(ctx, cfg, "")
	if err != nil {
		return err
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.sessions[connID]; ok { // lost the race; keep the first
		_ = sess.Close()
		if release != nil {
			release()
		}
		return nil
	}
	a.sessions[connID] = &openSession{session: sess, cfg: cfg, release: release}
	return nil
}

// ServerDatabases lists the databases on a connected SQL server, for the
// database switcher.
func (a *App) ServerDatabases(connID string) ([]string, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	l, ok := os.session.(drivers.DatabaseLister)
	if !ok {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return l.ListServerDatabases(ctx)
}

// SwitchDatabase reconnects a connection to a different database on the same
// server and persists the choice.
func (a *App) SwitchDatabase(connID, database string) error {
	a.mu.Lock()
	cur, ok := a.sessions[connID]
	a.mu.Unlock()
	if !ok {
		return errors.New("not connected")
	}
	cfg := cur.cfg
	if cfg.Database == database {
		return nil
	}
	cfg.Database = database
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	sess, release, err := a.open(ctx, cfg, "")
	if err != nil {
		return err
	}
	a.mu.Lock()
	old := a.sessions[connID]
	a.sessions[connID] = &openSession{session: sess, cfg: cfg, release: release}
	a.mu.Unlock()
	if old != nil {
		_ = old.session.Close()
		if old.release != nil {
			old.release()
		}
	}
	_ = a.meta.SaveConnection(cfg) // persist the active database
	return nil
}

// Disconnect closes the session for a connection, if open.
func (a *App) Disconnect(connID string) error {
	a.mu.Lock()
	os, ok := a.sessions[connID]
	if ok {
		delete(a.sessions, connID)
	}
	a.mu.Unlock()
	if !ok {
		return nil
	}
	err := os.session.Close()
	if os.release != nil {
		os.release()
	}
	return err
}

// open resolves secrets and the optional SSH tunnel, then connects.
func (a *App) open(ctx context.Context, cfg drivers.ConnectionConfig, password string) (drivers.Session, func(), error) {
	driver, err := drivers.Get(cfg.Engine)
	if err != nil {
		return nil, nil, err
	}
	if password == "" && cfg.ID != "" {
		if secret, err := a.secrets.Get(passwordRef(cfg.ID)); err == nil {
			password = string(secret)
		}
	}
	opts := drivers.ConnectOptions{Password: password}

	var release func()
	if cfg.SSH != nil {
		dialer, err := a.tunnels.Lease(ctx, cfg.SSH, tunnel.Auth{})
		if err != nil {
			return nil, nil, fmt.Errorf("ssh tunnel: %w", err)
		}
		ssh := cfg.SSH
		release = func() { a.tunnels.Release(ssh) }
		opts.Dialer = dialer
	}

	sess, err := driver.Connect(ctx, &cfg, opts)
	if err != nil {
		if release != nil {
			release()
		}
		return nil, nil, err
	}
	return sess, release, nil
}

func (a *App) config(connID string) (drivers.ConnectionConfig, error) {
	all, err := a.meta.Connections()
	if err != nil {
		return drivers.ConnectionConfig{}, err
	}
	for _, c := range all {
		if c.ID == connID {
			return c, nil
		}
	}
	return drivers.ConnectionConfig{}, fmt.Errorf("unknown connection %q", connID)
}

func (a *App) session(connID string) (*openSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	os, ok := a.sessions[connID]
	if !ok {
		return nil, errors.New("not connected")
	}
	return os, nil
}

// --- Schema & queries ---------------------------------------------------

// Introspect returns one lazily-expanded level of the schema tree.
func (a *App) Introspect(connID string, scope drivers.IntrospectScope) (*drivers.SchemaTree, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return os.session.Introspect(ctx, scope)
}

// --- Table data (design §6) --------------------------------------------

func (a *App) tableEditor(connID string) (drivers.TableEditor, *openSession, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, nil, err
	}
	te, ok := os.session.(drivers.TableEditor)
	if !ok {
		return nil, nil, errors.New("this connection does not support table editing")
	}
	return te, os, nil
}

// OpenTable returns column metadata and primary key for the data grid.
func (a *App) OpenTable(connID, schema, table string) (*drivers.TableInfo, error) {
	te, _, err := a.tableEditor(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return te.TableInfo(ctx, schema, table)
}

// LoadTableRows reads one page of table data synchronously.
func (a *App) LoadTableRows(connID string, req drivers.PageRequest) (*drivers.Page, error) {
	te, _, err := a.tableEditor(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 60*time.Second)
	defer cancel()
	return te.ReadPage(ctx, req)
}

// CountTableRows returns the total matching rows for the current filters,
// so the UI can jump to the last page and show a total.
func (a *App) CountTableRows(connID string, req drivers.PageRequest) (int64, error) {
	te, _, err := a.tableEditor(connID)
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 60*time.Second)
	defer cancel()
	return te.CountRows(ctx, req)
}

// PreviewChangeset returns the generated SQL for pending edits without
// touching the database.
func (a *App) PreviewChangeset(connID string, req drivers.ChangesetRequest) ([]string, error) {
	te, _, err := a.tableEditor(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return te.PreviewChanges(ctx, req)
}

// ApplyChangeset applies pending edits atomically. Blocked on read-only
// connections; the frontend gates the prod confirmation before calling.
func (a *App) ApplyChangeset(connID string, req drivers.ChangesetRequest) (*drivers.ChangesetResult, error) {
	te, os, err := a.tableEditor(connID)
	if err != nil {
		return nil, err
	}
	if os.cfg.ReadOnly {
		return nil, errors.New("connection is read-only; edits are disabled")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 60*time.Second)
	defer cancel()
	result, err := te.ApplyChanges(ctx, req)
	// Record applied statements to history so they appear in the SQL log.
	if err == nil && result != nil {
		now := time.Now()
		for _, sqlText := range result.Previews {
			_ = a.meta.RecordHistory(connID, sqlText, now, 0, result.RowsAffected, "")
		}
	}
	return result, err
}

// --- DDL: create/alter databases, tables, columns -----------------------

// schemaEditor returns the connection's DDL editor, refusing on read-only
// connections so every DDL entry point is guarded in one place.
func (a *App) schemaEditor(connID string) (drivers.SchemaEditor, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	se, ok := os.session.(drivers.SchemaEditor)
	if !ok {
		return nil, errors.New("this connection does not support schema changes")
	}
	if os.cfg.ReadOnly {
		return nil, errors.New("connection is read-only; schema changes are disabled")
	}
	return se, nil
}

// ddlCtx is the shared timeout for a single DDL statement.
func (a *App) ddlCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(a.ctx, 60*time.Second)
}

func (a *App) CreateDatabase(connID, name string) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.CreateDatabase(ctx, name)
}

func (a *App) DropDatabase(connID, name string) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.DropDatabase(ctx, name)
}

func (a *App) CreateTable(connID string, spec drivers.TableSpec) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.CreateTable(ctx, spec)
}

func (a *App) DropTable(connID, schema, table string) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.DropTable(ctx, schema, table)
}

func (a *App) RenameTable(connID, schema, table, newName string) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.RenameTable(ctx, schema, table, newName)
}

func (a *App) AddColumn(connID, schema, table string, col drivers.ColumnSpec) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.AddColumn(ctx, schema, table, col)
}

func (a *App) DropColumn(connID, schema, table, column string) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.DropColumn(ctx, schema, table, column)
}

func (a *App) RenameColumn(connID, schema, table, column, newName string) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.RenameColumn(ctx, schema, table, column, newName)
}

func (a *App) ModifyColumn(connID, schema, table, oldName string, spec drivers.ColumnSpec) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.ModifyColumn(ctx, schema, table, oldName, spec)
}

func (a *App) SetPrimaryKey(connID, schema, table string, columns []string) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.SetPrimaryKey(ctx, schema, table, columns)
}

// ListIndexes is a read, so it works on read-only connections too (it uses the
// session directly rather than the write-guarded schemaEditor).
func (a *App) ListIndexes(connID, schema, table string) ([]drivers.IndexInfo, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	se, ok := os.session.(drivers.SchemaEditor)
	if !ok {
		return nil, errors.New("this connection does not support schema changes")
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.ListIndexes(ctx, schema, table)
}

func (a *App) CreateIndex(connID, schema, table string, spec drivers.IndexSpec) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.CreateIndex(ctx, schema, table, spec)
}

func (a *App) DropIndex(connID, schema, table, name string) error {
	se, err := a.schemaEditor(connID)
	if err != nil {
		return err
	}
	ctx, cancel := a.ddlCtx()
	defer cancel()
	return se.DropIndex(ctx, schema, table, name)
}

// SaveTextFile prompts for a location and writes content there. Used by the
// data exporters. Returns the chosen path, or "" if the user cancelled.
func (a *App) SaveTextFile(defaultName, content string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultName,
		Title:           "Export data",
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // user cancelled
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// --- Redis (design §4/§6) ----------------------------------------------

func (a *App) keyValue(connID string) (drivers.KeyValue, *openSession, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, nil, err
	}
	kv, ok := os.session.(drivers.KeyValue)
	if !ok {
		return nil, nil, errors.New("this connection is not a key-value store")
	}
	return kv, os, nil
}

// RedisDatabases lists logical databases 0–15 with key counts.
func (a *App) RedisDatabases(connID string) ([]drivers.RedisDB, error) {
	kv, _, err := a.keyValue(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return kv.ListDatabases(ctx)
}

// RedisScan returns one SCAN page of keys with types and TTLs.
func (a *App) RedisScan(connID string, req drivers.ScanRequest) (*drivers.ScanResult, error) {
	kv, _, err := a.keyValue(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return kv.ScanKeys(ctx, req)
}

// RedisGet returns the type-aware value and TTL of a key.
func (a *App) RedisGet(connID string, db int, key string) (*drivers.RedisValue, error) {
	kv, _, err := a.keyValue(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return kv.GetValue(ctx, db, key)
}

// RedisSetString overwrites a string key (blocked on read-only connections).
func (a *App) RedisSetString(connID string, db int, key, value string) error {
	kv, os, err := a.keyValue(connID)
	if err != nil {
		return err
	}
	if os.cfg.ReadOnly {
		return errors.New("connection is read-only; edits are disabled")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return kv.SetString(ctx, db, key, value)
}

// RedisSetTTL sets a key's expiry in seconds; negative persists it.
func (a *App) RedisSetTTL(connID string, db int, key string, seconds int64) error {
	kv, os, err := a.keyValue(connID)
	if err != nil {
		return err
	}
	if os.cfg.ReadOnly {
		return errors.New("connection is read-only; edits are disabled")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return kv.SetTTL(ctx, db, key, seconds)
}

// RedisDelete removes a key (blocked on read-only connections).
func (a *App) RedisDelete(connID string, db int, key string) error {
	kv, os, err := a.keyValue(connID)
	if err != nil {
		return err
	}
	if os.cfg.ReadOnly {
		return errors.New("connection is read-only; edits are disabled")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return kv.DeleteKey(ctx, db, key)
}

// RedisCommand runs a raw command for the REPL and records it in history.
func (a *App) RedisCommand(connID string, db int, command string) (*drivers.RedisReply, error) {
	kv, _, err := a.keyValue(connID)
	if err != nil {
		return nil, err
	}
	args := strings.Fields(command)
	if len(args) == 0 {
		return &drivers.RedisReply{}, nil
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	started := time.Now()
	reply, err := kv.RawCommand(ctx, db, args)
	errText := ""
	if err != nil {
		errText = err.Error()
	} else if reply != nil {
		errText = reply.Error
	}
	_ = a.meta.RecordHistory(connID, command, started, time.Since(started), 0, errText)
	return reply, err
}

// --- History ------------------------------------------------------------

// ListHistory returns recent query-history entries, optionally filtered.
func (a *App) ListHistory(connID, search string, limit int) ([]meta.HistoryEntry, error) {
	return a.meta.History(connID, search, limit)
}

// GetAutocomplete returns a "schema.table" → columns map for the editor.
func (a *App) GetAutocomplete(connID string) (map[string][]string, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	p, ok := os.session.(drivers.AutocompleteProvider)
	if !ok {
		return map[string][]string{}, nil
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return p.AutocompleteMap(ctx)
}

// RunQuery executes a statement asynchronously. Row batches stream to the
// frontend as EvQueryBatch events; completion (or failure) arrives as one
// EvQueryDone event carrying the QuerySummary.
func (a *App) RunQuery(connID string, queryID string, statement string, maxRows int) error {
	os, err := a.session(connID)
	if err != nil {
		return err
	}
	if os.cfg.ReadOnly && !isReadOnlyStatement(statement) {
		return errors.New("connection is read-only; only SELECT-style statements are allowed")
	}
	go func() {
		started := time.Now()
		summary, err := os.session.Execute(a.ctx, drivers.QueryRequest{
			QueryID:   drivers.QueryID(queryID),
			Statement: statement,
			MaxRows:   maxRows,
		}, func(batch drivers.RowBatch) {
			runtime.EventsEmit(a.ctx, EvQueryBatch, batch)
		})
		if err != nil { // driver-internal failure; surface like a query error
			summary = &drivers.QuerySummary{QueryID: drivers.QueryID(queryID), Error: err.Error()}
		}
		_ = a.meta.RecordHistory(connID, statement, started, time.Since(started), summary.RowsReturned, summary.Error)
		runtime.EventsEmit(a.ctx, EvQueryDone, summary)
	}()
	return nil
}

// isReadOnlyStatement reports whether a statement only reads data, so it is
// safe on a read-only connection. Conservative: anything not clearly a read
// is treated as a write.
func isReadOnlyStatement(statement string) bool {
	head := strings.ToLower(strings.TrimSpace(statement))
	head = strings.TrimLeft(head, "(")
	for _, kw := range []string{"select ", "select\n", "select\t", "show ", "describe ", "desc ", "explain ", "with ", "table ", "values "} {
		if strings.HasPrefix(head, kw) {
			return true
		}
	}
	return head == "select" // bare, e.g. "SELECT 1" already matched above
}

// ExplainQuery returns the query plan for a statement as a tree.
func (a *App) ExplainQuery(connID string, statement string) (*drivers.PlanNode, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	ex, ok := os.session.(drivers.Explainer)
	if !ok {
		return nil, errors.New("this connection does not support EXPLAIN")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return ex.Explain(ctx, statement)
}

// SetReadOnly toggles the read-only flag for an open session (per-session;
// not persisted). Used by the UI's prod-safety confirmation flow.
func (a *App) SetReadOnly(connID string, readOnly bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	os, ok := a.sessions[connID]
	if !ok {
		return errors.New("not connected")
	}
	os.cfg.ReadOnly = readOnly
	return nil
}

// CancelQuery cancels a running query on a connection.
func (a *App) CancelQuery(connID string, queryID string) error {
	os, err := a.session(connID)
	if err != nil {
		return err
	}
	return os.session.Cancel(a.ctx, drivers.QueryID(queryID))
}

// FetchCell resolves an oversized-cell ref to its full value.
func (a *App) FetchCell(connID string, ref string) (*drivers.Value, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	f, ok := os.session.(drivers.CellFetcher)
	if !ok {
		return nil, errors.New("connection does not support cell fetch")
	}
	v, ok := f.FetchCell(ref)
	if !ok {
		return nil, errors.New("value no longer available")
	}
	return v, nil
}
