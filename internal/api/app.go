// Package api holds the Wails bound methods — the only surface the webview
// can call (design §8). Handlers stay thin; logic lives in the packages above.
package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"datagrid/internal/backup"
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

type SQLScratchFile struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Content string `json:"content"`
}

func (a *App) OpenSQLScratch() (*SQLScratchFile, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Open SQL scratch file",
		Filters: []runtime.FileFilter{{DisplayName: "SQL files", Pattern: "*.sql"}},
	})
	if err != nil || path == "" {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > 10*1024*1024 {
		return nil, errors.New("SQL scratch file exceeds 10 MB")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return &SQLScratchFile{Path: path, Name: info.Name(), Content: string(content)}, nil
}

func (a *App) SaveSQLScratch(defaultName, content string) (string, error) {
	if defaultName == "" {
		defaultName = "scratch.sql"
	}
	if !strings.HasSuffix(strings.ToLower(defaultName), ".sql") {
		defaultName += ".sql"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: "Save SQL scratch file", DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{{DisplayName: "SQL files", Pattern: "*.sql"}},
	})
	if err != nil || path == "" {
		return path, err
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

type BackupResult struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

func (a *App) BackupDatabase(connID, format string) (*BackupResult, error) {
	cfg, password, err := a.backupConnection(connID, false)
	if err != nil {
		return nil, err
	}
	extension := ".sql"
	if cfg.Engine == "postgres" && format == "custom" {
		extension = ".dump"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: "Back up database", DefaultFilename: cfg.Database + "-" + time.Now().Format("20060102-150405") + extension,
		Filters: []runtime.FileFilter{{DisplayName: "Database backup", Pattern: "*" + extension}},
	})
	if err != nil || path == "" {
		return nil, err
	}
	command, err := backup.Dump(cfg, password, path, format)
	if err != nil {
		return nil, err
	}
	if err := runBackupCommand(a.ctx, command); err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	return &BackupResult{Path: path, Size: info.Size()}, nil
}

func (a *App) RestoreDatabase(connID string, clean bool) (*BackupResult, error) {
	cfg, password, err := a.backupConnection(connID, true)
	if err != nil {
		return nil, err
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Restore database backup",
		Filters: []runtime.FileFilter{{DisplayName: "Database backups", Pattern: "*.sql;*.dump;*.backup"}},
	})
	if err != nil || path == "" {
		return nil, err
	}
	command, err := backup.Restore(cfg, password, path, clean)
	if err != nil {
		return nil, err
	}
	if err := runBackupCommand(a.ctx, command); err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	return &BackupResult{Path: path, Size: info.Size()}, nil
}

func (a *App) backupConnection(connID string, writable bool) (drivers.ConnectionConfig, string, error) {
	osession, err := a.session(connID)
	if err != nil {
		return drivers.ConnectionConfig{}, "", err
	}
	cfg := osession.cfg
	if cfg.Engine != "postgres" && cfg.Engine != "mysql" {
		return cfg, "", fmt.Errorf("backup is not supported for %s", cfg.Engine)
	}
	if cfg.SSH != nil {
		return cfg, "", errors.New("native backup tools do not yet support SSH-tunneled connections")
	}
	if writable && cfg.ReadOnly {
		return cfg, "", errors.New("restore is disabled for a read-only connection")
	}
	password := ""
	if secret, secretErr := a.secrets.Get(passwordRef(cfg.ID)); secretErr == nil {
		password = string(secret)
	}
	return cfg, password, nil
}

func runBackupCommand(ctx context.Context, command backup.Command) error {
	tool, err := exec.LookPath(command.Tool)
	if err != nil {
		return fmt.Errorf("%s is not installed or not on PATH", command.Tool)
	}
	commandCtx, cancel := context.WithTimeout(ctx, 2*time.Hour)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, tool, command.Args...)
	cmd.Env = append(os.Environ(), command.Env...)
	if command.StdinPath != "" {
		input, openErr := os.Open(command.StdinPath)
		if openErr != nil {
			return openErr
		}
		defer input.Close()
		cmd.Stdin = input
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 4000 {
			message = message[len(message)-4000:]
		}
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("%s failed: %s", filepath.Base(tool), message)
	}
	return nil
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

type ConnectionDiagnostics struct {
	Engine        string    `json:"engine"`
	Host          string    `json:"host"`
	Port          int       `json:"port"`
	Database      string    `json:"database"`
	User          string    `json:"user"`
	ServerVersion string    `json:"serverVersion"`
	LatenciesMs   []float64 `json:"latenciesMs"`
	TLSActive     bool      `json:"tlsActive"`
	TLSDetail     string    `json:"tlsDetail"`
	SSHActive     bool      `json:"sshActive"`
	SSHHost       string    `json:"sshHost"`
	CheckedAt     string    `json:"checkedAt"`
}

type ConnectionHealth struct {
	LatencyMs float64 `json:"latencyMs"`
	CheckedAt string  `json:"checkedAt"`
}

func (a *App) PingConnection(connID string) (*ConnectionHealth, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 5*time.Second)
	defer cancel()
	started := time.Now()
	if err := os.session.Ping(ctx); err != nil {
		return nil, err
	}
	return &ConnectionHealth{LatencyMs: float64(time.Since(started).Microseconds()) / 1000, CheckedAt: time.Now().Format(time.RFC3339)}, nil
}

func (a *App) DiagnoseConnection(connID string) (*ConnectionDiagnostics, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 45*time.Second)
	defer cancel()
	result := &ConnectionDiagnostics{Engine: string(os.cfg.Engine), Host: os.cfg.Host, Port: os.cfg.Port, Database: os.cfg.Database, User: os.cfg.User, LatenciesMs: make([]float64, 0, 5), CheckedAt: time.Now().Format(time.RFC3339)}
	if os.cfg.SSH != nil {
		result.SSHActive = true
		result.SSHHost = fmt.Sprintf("%s@%s:%d", os.cfg.SSH.User, os.cfg.SSH.Host, os.cfg.SSH.Port)
	}
	for iteration := 0; iteration < 5; iteration++ {
		started := time.Now()
		if err := os.session.Ping(ctx); err != nil {
			return nil, fmt.Errorf("diagnostic ping %d failed: %w", iteration+1, err)
		}
		result.LatenciesMs = append(result.LatenciesMs, float64(time.Since(started).Microseconds())/1000)
	}
	if os.cfg.Engine == drivers.EnginePostgres {
		result.ServerVersion, _ = a.diagnosticScalar(ctx, os, "diagnostic-version", "SELECT version()", 0)
		tls, _ := a.diagnosticScalar(ctx, os, "diagnostic-tls", "SELECT COALESCE((SELECT ssl::text FROM pg_stat_ssl WHERE pid = pg_backend_pid()), 'false')", 0)
		result.TLSActive = strings.EqualFold(tls, "true")
		result.TLSDetail = map[bool]string{true: "PostgreSQL SSL session", false: "Not reported by pg_stat_ssl"}[result.TLSActive]
	} else if os.cfg.Engine == drivers.EngineMySQL {
		result.ServerVersion, _ = a.diagnosticScalar(ctx, os, "diagnostic-version", "SELECT VERSION()", 0)
		cipher, _ := a.diagnosticScalar(ctx, os, "diagnostic-tls", "SHOW STATUS LIKE 'Ssl_cipher'", 1)
		result.TLSActive = cipher != ""
		result.TLSDetail = map[bool]string{true: cipher, false: "No TLS cipher reported"}[result.TLSActive]
	}
	return result, nil
}

func (a *App) diagnosticScalar(ctx context.Context, os *openSession, id, statement string, column int) (string, error) {
	value := ""
	summary, err := os.session.Execute(ctx, drivers.QueryRequest{QueryID: drivers.QueryID(id), Statement: statement, MaxRows: 1}, func(batch drivers.RowBatch) {
		if len(batch.Rows) == 0 || column >= len(batch.Rows[0]) {
			return
		}
		if cell, ok := batch.Rows[0][column].(drivers.Value); ok && cell.V != nil {
			value = fmt.Sprint(cell.V)
		}
	})
	if err != nil {
		return "", err
	}
	if summary.Error != "" {
		return "", errors.New(summary.Error)
	}
	return value, nil
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

// GetObjectDDL returns engine-native DDL/source for a schema object.
func (a *App) GetObjectDDL(connID, kind, schema, name string) (string, error) {
	os, err := a.session(connID)
	if err != nil {
		return "", err
	}
	provider, ok := os.session.(drivers.ObjectDefiner)
	if !ok {
		return "", errors.New("this connection does not support object DDL")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return provider.ObjectDDL(ctx, kind, schema, name)
}

func (a *App) SearchDatabaseData(connID string, request drivers.DataSearchRequest) (*drivers.DataSearchResult, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	searcher, ok := os.session.(drivers.DataSearcher)
	if !ok {
		return nil, errors.New("this connection does not support data search")
	}
	if len(strings.TrimSpace(request.Query)) < 2 {
		return nil, errors.New("search text must contain at least 2 characters")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
	defer cancel()
	return searcher.SearchData(ctx, request)
}

// ApplyMigration executes an edited schema migration. PostgreSQL DDL is
// wrapped in a pinned transaction; MySQL/MariaDB DDL is sequential because
// those engines implicitly commit many schema statements.
func (a *App) ApplyMigration(connID, script string) error {
	os, err := a.session(connID)
	if err != nil {
		return err
	}
	if os.cfg.ReadOnly {
		return errors.New("connection is read-only")
	}
	statements := drivers.SplitSQLStatements(script, os.cfg.Engine)
	if len(statements) == 0 {
		return errors.New("migration is empty")
	}
	txID := fmt.Sprintf("migration-%d", time.Now().UnixNano())
	transactional := os.cfg.Engine == drivers.EnginePostgres
	var tx drivers.TransactionController
	if transactional {
		var ok bool
		tx, ok = os.session.(drivers.TransactionController)
		if !ok {
			return errors.New("connection does not support transactional migrations")
		}
		if err := tx.BeginTransaction(a.ctx, txID); err != nil {
			return err
		}
	}
	rollback := func() {
		if transactional {
			_ = tx.RollbackTransaction(context.Background(), txID)
		}
	}
	for index, statement := range statements {
		summary, err := os.session.Execute(a.ctx, drivers.QueryRequest{
			QueryID: drivers.QueryID(fmt.Sprintf("%s-%d", txID, index)), Statement: statement,
			TransactionID: map[bool]string{true: txID, false: ""}[transactional],
		}, func(drivers.RowBatch) {})
		if err != nil {
			rollback()
			return err
		}
		if summary.Error != "" {
			rollback()
			return fmt.Errorf("migration statement %d: %s", index+1, summary.Error)
		}
	}
	if transactional {
		if err := tx.CommitTransaction(a.ctx, txID); err != nil {
			rollback()
			return err
		}
	}
	return nil
}

func (a *App) ApplyObjectSource(connID, kind, schema, name, source string) error {
	os, err := a.session(connID)
	if err != nil {
		return err
	}
	if os.cfg.ReadOnly {
		return errors.New("connection is read-only")
	}
	if kind != "view" && kind != "routine" && kind != "trigger" && kind != "sequence" {
		return fmt.Errorf("editing %s source is not supported", kind)
	}
	if strings.TrimSpace(source) == "" {
		return errors.New("object source is empty")
	}
	if os.cfg.Engine == drivers.EnginePostgres {
		script, err := postgresObjectScript(kind, name, source)
		if err != nil {
			return err
		}
		return a.ApplyMigration(connID, script)
	}
	statements, err := mysqlObjectStatements(kind, schema, name, source)
	if err != nil {
		return err
	}
	for index, statement := range statements {
		if err := a.executeObjectStatement(os, fmt.Sprintf("object-%d", index), statement); err != nil {
			if (kind == "routine" || kind == "trigger") && index > 0 {
				return fmt.Errorf("%s was dropped but replacement failed: %w", kind, err)
			}
			return err
		}
	}
	return nil
}

func (a *App) CreateObjectSource(connID, kind, source string) error {
	os, err := a.session(connID)
	if err != nil {
		return err
	}
	if os.cfg.ReadOnly {
		return errors.New("connection is read-only")
	}
	if kind != "view" && kind != "routine" && kind != "trigger" {
		return fmt.Errorf("creating %s source is not supported", kind)
	}
	if strings.TrimSpace(source) == "" {
		return errors.New("object source is empty")
	}
	if os.cfg.Engine == drivers.EnginePostgres {
		return a.ApplyMigration(connID, source)
	}
	return a.executeObjectStatement(os, "object-create", source)
}

func (a *App) DropSchemaObject(connID, kind, schema, name string) error {
	os, source, err := a.objectSessionAndSource(connID, kind, schema, name)
	if err != nil {
		return err
	}
	statement, err := objectDropStatement(os.cfg.Engine, kind, schema, name, source)
	if err != nil {
		return err
	}
	if os.cfg.Engine == drivers.EnginePostgres {
		return a.ApplyMigration(connID, statement)
	}
	return a.executeObjectStatement(os, "object-drop", statement)
}

func (a *App) RenameSchemaObject(connID, kind, schema, name, newName string) error {
	os, source, err := a.objectSessionAndSource(connID, kind, schema, name)
	if err != nil {
		return err
	}
	if strings.TrimSpace(newName) == "" {
		return errors.New("new object name is required")
	}
	statement, err := objectRenameStatement(os.cfg.Engine, kind, schema, name, newName, source)
	if err != nil {
		return err
	}
	if os.cfg.Engine == drivers.EnginePostgres {
		return a.ApplyMigration(connID, statement)
	}
	return a.executeObjectStatement(os, "object-rename", statement)
}

func (a *App) objectSessionAndSource(connID, kind, schema, name string) (*openSession, string, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, "", err
	}
	if os.cfg.ReadOnly {
		return nil, "", errors.New("connection is read-only")
	}
	provider, ok := os.session.(drivers.ObjectDefiner)
	if !ok {
		return nil, "", errors.New("this connection does not support object DDL")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	source, err := provider.ObjectDDL(ctx, kind, schema, name)
	return os, source, err
}

func objectDropStatement(engine drivers.Engine, kind, schema, name, source string) (string, error) {
	quote := objectIdentifierQuoter(engine)
	qualified := quote(schema) + "." + quote(name)
	upper := strings.ToUpper(source)
	switch kind {
	case "view":
		objectType := "VIEW"
		if engine == drivers.EnginePostgres && strings.Contains(upper, "CREATE MATERIALIZED VIEW") {
			objectType = "MATERIALIZED VIEW"
		}
		return "DROP " + objectType + " " + qualified, nil
	case "sequence":
		return "DROP SEQUENCE " + qualified, nil
	case "trigger":
		if engine == drivers.EngineMySQL {
			return "DROP TRIGGER " + qualified, nil
		}
		target, err := postgresTriggerTarget(source)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("DROP TRIGGER %s ON %s", quote(name), target), nil
	case "routine":
		routineType, keyword := "FUNCTION", " FUNCTION "
		if strings.Contains(upper, " PROCEDURE ") {
			routineType, keyword = "PROCEDURE", " PROCEDURE "
		}
		if engine == drivers.EngineMySQL {
			return "DROP " + routineType + " " + qualified, nil
		}
		signature, err := postgresRoutineSignature(source, keyword)
		if err != nil {
			return "", err
		}
		return "DROP " + routineType + " " + routineIdentitySignature(signature), nil
	default:
		return "", fmt.Errorf("dropping %s is not supported", kind)
	}
}

func objectRenameStatement(engine drivers.Engine, kind, schema, name, newName, source string) (string, error) {
	quote := objectIdentifierQuoter(engine)
	qualified := quote(schema) + "." + quote(name)
	if kind == "view" {
		if engine == drivers.EngineMySQL {
			return fmt.Sprintf("RENAME TABLE %s TO %s.%s", qualified, quote(schema), quote(newName)), nil
		}
		objectType := "VIEW"
		if strings.Contains(strings.ToUpper(source), "CREATE MATERIALIZED VIEW") {
			objectType = "MATERIALIZED VIEW"
		}
		return fmt.Sprintf("ALTER %s %s RENAME TO %s", objectType, qualified, quote(newName)), nil
	}
	if kind == "sequence" && engine == drivers.EnginePostgres {
		return fmt.Sprintf("ALTER SEQUENCE %s RENAME TO %s", qualified, quote(newName)), nil
	}
	return "", fmt.Errorf("renaming %s is not supported by %s", kind, engine)
}

func objectIdentifierQuoter(engine drivers.Engine) func(string) string {
	return func(value string) string {
		if engine == drivers.EngineMySQL {
			return "`" + strings.ReplaceAll(value, "`", "``") + "`"
		}
		return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
	}
}

func postgresTriggerTarget(source string) (string, error) {
	upper := strings.ToUpper(source)
	on := strings.Index(upper, " ON ")
	if on < 0 {
		return "", errors.New("trigger source must contain an ON target table")
	}
	start, end := on+4, on+4
	for end < len(source) && source[end] != ' ' && source[end] != '\n' && source[end] != '\r' && source[end] != '\t' {
		end++
	}
	target := strings.TrimSpace(source[start:end])
	if target == "" {
		return "", errors.New("trigger target table is missing")
	}
	return target, nil
}

func postgresRoutineSignature(source, keyword string) (string, error) {
	upper := strings.ToUpper(source)
	start := strings.Index(upper, keyword)
	if start < 0 {
		return "", errors.New("routine source has no function or procedure signature")
	}
	start += len(keyword)
	openOffset := strings.IndexByte(source[start:], '(')
	if openOffset < 0 {
		return "", errors.New("routine signature has no argument list")
	}
	open, depth := start+openOffset, 0
	for index := open; index < len(source); index++ {
		if source[index] == '(' {
			depth++
		}
		if source[index] == ')' {
			depth--
			if depth == 0 {
				return strings.TrimSpace(source[start : index+1]), nil
			}
		}
	}
	return "", errors.New("routine signature has an unterminated argument list")
}

func routineIdentitySignature(signature string) string {
	open := strings.IndexByte(signature, '(')
	if open < 0 || !strings.HasSuffix(signature, ")") {
		return signature
	}
	body := signature[open+1 : len(signature)-1]
	var args []string
	start, depth := 0, 0
	for index := 0; index <= len(body); index++ {
		if index < len(body) {
			if body[index] == '(' {
				depth++
			}
			if body[index] == ')' {
				depth--
			}
		}
		if index == len(body) || body[index] == ',' && depth == 0 {
			arg := strings.TrimSpace(body[start:index])
			upper := strings.ToUpper(arg)
			cut := len(arg)
			if at := strings.Index(upper, " DEFAULT "); at >= 0 {
				cut = at
			}
			if at := strings.Index(arg, "="); at >= 0 && at < cut {
				cut = at
			}
			args = append(args, strings.TrimSpace(arg[:cut]))
			start = index + 1
		}
	}
	return signature[:open+1] + strings.Join(args, ", ") + ")"
}

func mysqlObjectStatements(kind, schema, name, source string) ([]string, error) {
	statement := source
	if kind == "view" {
		upper := strings.ToUpper(strings.TrimSpace(statement))
		if strings.HasPrefix(upper, "CREATE ") && !strings.HasPrefix(upper, "CREATE OR REPLACE ") {
			leading := len(statement) - len(strings.TrimLeft(statement, " \t\r\n"))
			statement = statement[:leading] + "CREATE OR REPLACE " + statement[leading+len("CREATE "):]
		}
		return []string{statement}, nil
	}
	quote := func(identifier string) string { return "`" + strings.ReplaceAll(identifier, "`", "``") + "`" }
	if kind == "trigger" {
		return []string{fmt.Sprintf("DROP TRIGGER IF EXISTS %s.%s", quote(schema), quote(name)), statement}, nil
	}
	if kind == "sequence" {
		altered, err := replaceCreateWithAlter(statement, "SEQUENCE")
		if err != nil {
			return nil, err
		}
		return []string{altered}, nil
	}
	upper := strings.ToUpper(statement)
	procedureAt := strings.Index(upper, " PROCEDURE ")
	functionAt := strings.Index(upper, " FUNCTION ")
	routineType := ""
	if procedureAt >= 0 && (functionAt < 0 || procedureAt < functionAt) {
		routineType = "PROCEDURE"
	}
	if functionAt >= 0 && (procedureAt < 0 || functionAt < procedureAt) {
		routineType = "FUNCTION"
	}
	if routineType == "" {
		return nil, errors.New("routine source must contain CREATE PROCEDURE or CREATE FUNCTION")
	}
	return []string{fmt.Sprintf("DROP %s IF EXISTS %s.%s", routineType, quote(schema), quote(name)), statement}, nil
}

func postgresObjectScript(kind, name, source string) (string, error) {
	if kind == "trigger" {
		target, err := postgresTriggerTarget(source)
		if err != nil {
			return "", err
		}
		quotedName := `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
		return fmt.Sprintf("DROP TRIGGER %s ON %s;\n%s", quotedName, target, source), nil
	}
	if kind == "sequence" {
		return replaceCreateWithAlter(source, "SEQUENCE")
	}
	return source, nil
}

func replaceCreateWithAlter(source, objectType string) (string, error) {
	trimmed := strings.TrimLeft(source, " \t\r\n")
	leading := source[:len(source)-len(trimmed)]
	upper := strings.ToUpper(trimmed)
	for _, prefix := range []string{"CREATE OR REPLACE " + objectType, "CREATE " + objectType} {
		if strings.HasPrefix(upper, prefix) {
			return leading + "ALTER " + objectType + trimmed[len(prefix):], nil
		}
	}
	return "", fmt.Errorf("source must start with CREATE %s", objectType)
}

func (a *App) executeObjectStatement(os *openSession, id, statement string) error {
	summary, err := os.session.Execute(a.ctx, drivers.QueryRequest{QueryID: drivers.QueryID(fmt.Sprintf("%s-%d", id, time.Now().UnixNano())), Statement: strings.TrimSpace(strings.TrimSuffix(statement, ";"))}, func(drivers.RowBatch) {})
	if err != nil {
		return err
	}
	if summary.Error != "" {
		return errors.New(summary.Error)
	}
	return nil
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
	if err == nil && result != nil && len(result.Conflicts) == 0 {
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

// SaveBinaryFile prompts for a location and writes base64-encoded bytes.
func (a *App) SaveBinaryFile(defaultName, encoded string) (string, error) {
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decode export: %w", err)
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{DefaultFilename: defaultName, Title: "Export data"})
	if err != nil || path == "" {
		return path, err
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
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
func (a *App) RunQuery(connID string, queryID string, statement string, maxRows int, transactionID string, parameters map[string]string, schemaContext []string, timeoutMs int) error {
	os, err := a.session(connID)
	if err != nil {
		return err
	}
	type compiledStatement struct {
		original string
		sql      string
		args     []any
	}
	parts := drivers.SplitSQLStatements(statement, os.cfg.Engine)
	if len(parts) == 0 {
		return errors.New("query is empty")
	}
	if timeoutMs < 0 || timeoutMs > 3_600_000 {
		return errors.New("query timeout must be between 0 and 3600000 milliseconds")
	}
	compiled := make([]compiledStatement, 0, len(parts))
	for _, part := range parts {
		if os.cfg.ReadOnly && !isReadOnlyStatement(part) {
			return errors.New("connection is read-only; only SELECT-style statements are allowed")
		}
		sqlText, args, err := drivers.CompileNamedParameters(part, os.cfg.Engine, parameters)
		if err != nil {
			return err
		}
		compiled = append(compiled, compiledStatement{original: part, sql: sqlText, args: args})
	}
	go func() {
		for index, part := range compiled {
			started := time.Now()
			queryCtx := a.ctx
			cancel := func() {}
			if timeoutMs > 0 {
				queryCtx, cancel = context.WithTimeout(a.ctx, time.Duration(timeoutMs)*time.Millisecond)
			}
			summary, err := os.session.Execute(queryCtx, drivers.QueryRequest{
				QueryID: drivers.QueryID(queryID), Statement: part.sql, Args: part.args,
				MaxRows: maxRows, TransactionID: transactionID, SchemaContext: schemaContext,
			}, func(batch drivers.RowBatch) {
				batch.ResultIndex = index
				runtime.EventsEmit(a.ctx, EvQueryBatch, batch)
			})
			cancel()
			if err != nil {
				summary = &drivers.QuerySummary{QueryID: drivers.QueryID(queryID), Error: err.Error()}
			}
			summary.ResultIndex = index
			summary.Statement = part.original
			summary.Final = index == len(compiled)-1 || summary.Error != ""
			_ = a.meta.RecordHistory(connID, part.original, started, time.Since(started), summary.RowsReturned, summary.Error)
			runtime.EventsEmit(a.ctx, EvQueryDone, summary)
			if summary.Error != "" {
				break
			}
		}
	}()
	return nil
}

// QueryResultFacet executes a bounded, read-only grouped SELECT without
// publishing query events, keeping facet requests isolated from the active
// result stream. The caller supplies a query ID so superseded requests can be
// cancelled through CancelQuery.
func (a *App) QueryResultFacet(connID, queryID, statement string, maxRows int, transactionID string, parameters map[string]string, schemaContext []string, timeoutMs int) (*drivers.Page, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	parts := drivers.SplitSQLStatements(statement, os.cfg.Engine)
	if len(parts) != 1 || !isPageableStatement(parts[0]) {
		return nil, errors.New("result facets require a single SELECT statement")
	}
	if queryID == "" {
		return nil, errors.New("facet query ID is required")
	}
	if maxRows < 1 || maxRows > 1000 {
		return nil, errors.New("facet row limit must be between 1 and 1000")
	}
	if timeoutMs < 0 || timeoutMs > 3_600_000 {
		return nil, errors.New("query timeout must be between 0 and 3600000 milliseconds")
	}
	compiled, args, err := drivers.CompileNamedParameters(parts[0], os.cfg.Engine, parameters)
	if err != nil {
		return nil, err
	}
	queryCtx := a.ctx
	cancel := func() {}
	if timeoutMs > 0 {
		queryCtx, cancel = context.WithTimeout(a.ctx, time.Duration(timeoutMs)*time.Millisecond)
	}
	defer cancel()
	page := &drivers.Page{Rows: make([][]any, 0, maxRows)}
	summary, err := os.session.Execute(queryCtx, drivers.QueryRequest{
		QueryID: drivers.QueryID(queryID), Statement: compiled, Args: args, MaxRows: maxRows,
		TransactionID: transactionID, SchemaContext: schemaContext,
	}, func(batch drivers.RowBatch) {
		if len(page.Columns) == 0 && len(batch.Columns) > 0 {
			page.Columns = batch.Columns
		}
		remaining := maxRows - len(page.Rows)
		if remaining > len(batch.Rows) {
			remaining = len(batch.Rows)
		}
		if remaining > 0 {
			page.Rows = append(page.Rows, batch.Rows[:remaining]...)
		}
	})
	if err != nil {
		return nil, err
	}
	page.HasMore = summary != nil && summary.Truncated
	return page, nil
}

// FetchQueryPage appends a page for a previously executed SELECT. Wrapping a
// single read statement avoids retaining driver cursors and pinned pooled
// connections between UI actions. Non-SELECT commands and scripts are rejected
// so fetching can never replay writes or procedural statements.
func (a *App) FetchQueryPage(connID, queryID, statement string, offset, limit, resultIndex int, transactionID string, parameters map[string]string, schemaContext []string, timeoutMs int) error {
	os, err := a.session(connID)
	if err != nil {
		return err
	}
	parts := drivers.SplitSQLStatements(statement, os.cfg.Engine)
	if len(parts) != 1 || !isPageableStatement(parts[0]) {
		return errors.New("additional fetching is supported only for a single SELECT statement")
	}
	if offset < 0 || limit < 1 || limit > 1_000_000 {
		return errors.New("fetch offset or page size is invalid")
	}
	if timeoutMs < 0 || timeoutMs > 3_600_000 {
		return errors.New("query timeout must be between 0 and 3600000 milliseconds")
	}
	compiled, args, err := drivers.CompileNamedParameters(parts[0], os.cfg.Engine, parameters)
	if err != nil {
		return err
	}
	paged := fmt.Sprintf("SELECT * FROM (%s) AS datagrid_page LIMIT %d OFFSET %d", strings.TrimSpace(strings.TrimSuffix(compiled, ";")), limit+1, offset)
	go func() {
		queryCtx := a.ctx
		cancel := func() {}
		if timeoutMs > 0 {
			queryCtx, cancel = context.WithTimeout(a.ctx, time.Duration(timeoutMs)*time.Millisecond)
		}
		emitted := 0
		hasMore := false
		summary, executeErr := os.session.Execute(queryCtx, drivers.QueryRequest{
			QueryID: drivers.QueryID(queryID), Statement: paged, Args: args,
			TransactionID: transactionID, SchemaContext: schemaContext,
		}, func(batch drivers.RowBatch) {
			remaining := limit - emitted
			if remaining < len(batch.Rows) {
				hasMore = true
				batch.Rows = batch.Rows[:max(0, remaining)]
			}
			if len(batch.Rows) > 0 || len(batch.Columns) > 0 {
				emitted += len(batch.Rows)
				batch.ResultIndex = resultIndex
				runtime.EventsEmit(a.ctx, EvQueryBatch, batch)
			}
		})
		cancel()
		if executeErr != nil {
			summary = &drivers.QuerySummary{QueryID: drivers.QueryID(queryID), Error: executeErr.Error()}
		}
		summary.RowsReturned = int64(emitted)
		summary.Truncated = hasMore
		summary.ResultIndex = resultIndex
		summary.Statement = parts[0]
		summary.Final = true
		runtime.EventsEmit(a.ctx, EvQueryDone, summary)
	}()
	return nil
}

func (a *App) transactionController(connID string) (drivers.TransactionController, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	tx, ok := os.session.(drivers.TransactionController)
	if !ok {
		return nil, errors.New("this connection does not support manual transactions")
	}
	return tx, nil
}

func (a *App) BeginTransaction(connID, transactionID string) error {
	tx, err := a.transactionController(connID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return tx.BeginTransaction(ctx, transactionID)
}

func (a *App) CommitTransaction(connID, transactionID string) error {
	tx, err := a.transactionController(connID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return tx.CommitTransaction(ctx, transactionID)
}

func (a *App) RollbackTransaction(connID, transactionID string) error {
	tx, err := a.transactionController(connID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return tx.RollbackTransaction(ctx, transactionID)
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

// isAnalyzableStatement is intentionally stricter than isReadOnlyStatement:
// PostgreSQL WITH clauses can contain data-modifying CTEs, and ANALYZE executes
// the statement rather than merely estimating it.
func isAnalyzableStatement(statement string) bool {
	head := strings.ToLower(strings.TrimSpace(statement))
	for strings.HasPrefix(head, "(") {
		head = strings.TrimSpace(strings.TrimPrefix(head, "("))
	}
	for _, kw := range []string{"select ", "select\n", "select\t", "table ", "values "} {
		if strings.HasPrefix(head, kw) {
			return true
		}
	}
	return head == "select"
}

func isPageableStatement(statement string) bool {
	head := strings.ToLower(strings.TrimSpace(statement))
	for strings.HasPrefix(head, "(") {
		head = strings.TrimSpace(strings.TrimPrefix(head, "("))
	}
	return head == "select" || strings.HasPrefix(head, "select ") || strings.HasPrefix(head, "select\n") || strings.HasPrefix(head, "select\t")
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

// AnalyzeQuery executes a read-only statement and returns its runtime plan.
func (a *App) AnalyzeQuery(connID string, statement string) (*drivers.PlanNode, error) {
	if !isAnalyzableStatement(statement) {
		return nil, errors.New("EXPLAIN ANALYZE is limited to read-only statements")
	}
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	analyzer, ok := os.session.(drivers.Analyzer)
	if !ok {
		return nil, errors.New("this connection does not support EXPLAIN ANALYZE")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
	defer cancel()
	return analyzer.Analyze(ctx, statement)
}

type BenchmarkResult struct {
	DurationsMs []float64 `json:"durationsMs"`
	Rows        int64     `json:"rows"`
}

func (a *App) BenchmarkQuery(connID, benchmarkID, statement string, warmups, runs int, parameters map[string]string) (*BenchmarkResult, error) {
	if !isAnalyzableStatement(statement) {
		return nil, errors.New("benchmarking is limited to read-only SELECT, TABLE, or VALUES statements")
	}
	if warmups < 0 || warmups > 10 {
		return nil, errors.New("warmups must be between 0 and 10")
	}
	if runs < 1 || runs > 50 {
		return nil, errors.New("runs must be between 1 and 50")
	}
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	parts := drivers.SplitSQLStatements(statement, os.cfg.Engine)
	if len(parts) != 1 {
		return nil, errors.New("benchmark exactly one statement at a time")
	}
	compiled, args, err := drivers.CompileNamedParameters(parts[0], os.cfg.Engine, parameters)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 10*time.Minute)
	defer cancel()
	result := &BenchmarkResult{DurationsMs: make([]float64, 0, runs)}
	for iteration := 0; iteration < warmups+runs; iteration++ {
		started := time.Now()
		summary, executeErr := os.session.Execute(ctx, drivers.QueryRequest{QueryID: drivers.QueryID(benchmarkID), Statement: compiled, Args: args}, func(drivers.RowBatch) {})
		if executeErr != nil {
			return nil, executeErr
		}
		if summary.Error != "" {
			return nil, errors.New(summary.Error)
		}
		if iteration >= warmups {
			result.DurationsMs = append(result.DurationsMs, float64(time.Since(started).Microseconds())/1000)
		}
		result.Rows = summary.RowsReturned
	}
	return result, nil
}

func (a *App) ListDatabaseSessions(connID string) ([]drivers.DatabaseSession, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	inspector, ok := os.session.(drivers.SessionInspector)
	if !ok {
		return nil, errors.New("this connection does not support session inspection")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return inspector.ListDatabaseSessions(ctx)
}

func (a *App) CancelDatabaseSession(connID, id string) error {
	os, err := a.session(connID)
	if err != nil {
		return err
	}
	inspector, ok := os.session.(drivers.SessionInspector)
	if !ok {
		return errors.New("this connection does not support session cancellation")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return inspector.CancelDatabaseSession(ctx, id)
}

func (a *App) MaintainTable(connID, schema, table, operation string) (string, error) {
	os, err := a.session(connID)
	if err != nil {
		return "", err
	}
	if os.cfg.ReadOnly {
		return "", errors.New("connection is read-only")
	}
	maintainer, ok := os.session.(drivers.TableMaintainer)
	if !ok {
		return "", errors.New("this connection does not support table maintenance")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 10*time.Minute)
	defer cancel()
	return maintainer.MaintainTable(ctx, schema, table, operation)
}

func (a *App) ListDatabasePrincipals(connID string) ([]drivers.DatabasePrincipal, error) {
	os, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	inspector, ok := os.session.(drivers.SecurityInspector)
	if !ok {
		return nil, errors.New("this connection does not support security inspection")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return inspector.ListDatabasePrincipals(ctx)
}

func (a *App) PreviewPrivilegeChange(connID string, change drivers.PrivilegeChange) (string, error) {
	os, err := a.session(connID)
	if err != nil {
		return "", err
	}
	editor, ok := os.session.(drivers.PrivilegeEditor)
	if !ok {
		return "", errors.New("this connection does not support privilege editing")
	}
	return editor.ChangePrivilege(a.ctx, change, false)
}

func (a *App) ApplyPrivilegeChange(connID string, change drivers.PrivilegeChange) (string, error) {
	os, err := a.session(connID)
	if err != nil {
		return "", err
	}
	if os.cfg.ReadOnly {
		return "", errors.New("connection is read-only")
	}
	editor, ok := os.session.(drivers.PrivilegeEditor)
	if !ok {
		return "", errors.New("this connection does not support privilege editing")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return editor.ChangePrivilege(ctx, change, true)
}

func (a *App) PreviewPrincipalChange(connID string, change drivers.PrincipalChange) (string, error) {
	os, err := a.session(connID)
	if err != nil {
		return "", err
	}
	editor, ok := os.session.(drivers.PrincipalEditor)
	if !ok {
		return "", errors.New("this connection does not support principal editing")
	}
	return editor.ChangePrincipal(a.ctx, change, false)
}

func (a *App) ApplyPrincipalChange(connID string, change drivers.PrincipalChange) (string, error) {
	os, err := a.session(connID)
	if err != nil {
		return "", err
	}
	if os.cfg.ReadOnly {
		return "", errors.New("connection is read-only")
	}
	editor, ok := os.session.(drivers.PrincipalEditor)
	if !ok {
		return "", errors.New("this connection does not support principal editing")
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	return editor.ChangePrincipal(ctx, change, true)
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
