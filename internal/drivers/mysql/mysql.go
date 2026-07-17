// Package mysql implements the drivers.Driver interface for MySQL and
// MariaDB on database/sql + go-sql-driver. MariaDB is detected by a
// version probe at connect time (design §4).
package mysql

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	gomysql "github.com/go-sql-driver/mysql"

	"datagrid/internal/drivers"
)

func init() {
	drivers.Register(drivers.EngineMySQL, &myDriver{})
}

type myDriver struct{}

func quoteDatabase(value string) string {
	return "`" + strings.ReplaceAll(value, "`", "``") + "`"
}

func applySchemaContext(ctx context.Context, conn *sql.Conn, schemas []string) (func(), error) {
	if len(schemas) == 0 || strings.TrimSpace(schemas[0]) == "" {
		return func() {}, nil
	}
	var previous sql.NullString
	if err := conn.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&previous); err != nil {
		return nil, err
	}
	if _, err := conn.ExecContext(ctx, "USE "+quoteDatabase(schemas[0])); err != nil {
		return nil, err
	}
	return func() {
		if !previous.Valid || previous.String == "" {
			return
		}
		restoreCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = conn.ExecContext(restoreCtx, "USE "+quoteDatabase(previous.String))
	}, nil
}

func (d *myDriver) Capabilities() drivers.Capabilities {
	return drivers.Capabilities{SQL: true, MultipleDatabases: true}
}

// dialerSeq generates unique custom-network names for per-connection SSH
// dialers (go-sql-driver has no way to unregister, so names are one-shot).
var dialerSeq atomic.Int64

func (d *myDriver) Connect(ctx context.Context, cfg *drivers.ConnectionConfig, opts drivers.ConnectOptions) (drivers.Session, error) {
	port := cfg.Port
	if port == 0 {
		port = 3306
	}

	mc := gomysql.NewConfig()
	mc.User = cfg.User
	mc.Passwd = opts.Password
	mc.Net = "tcp"
	mc.Addr = fmt.Sprintf("%s:%d", cfg.Host, port)
	mc.DBName = cfg.Database
	mc.ParseTime = true           // DATE/DATETIME/TIMESTAMP as time.Time
	mc.Timeout = 10 * time.Second // dial timeout — fail fast if unreachable

	switch cfg.TLSMode {
	case "", "prefer":
		mc.TLSConfig = "preferred"
	case "disable":
		mc.TLSConfig = "false"
	case "require":
		mc.TLSConfig = "skip-verify" // encrypted, chain not verified
	default: // verify-full and friends
		mc.TLSConfig = "true"
	}

	if opts.Dialer != nil {
		netName := fmt.Sprintf("tcp-ssh-%d", dialerSeq.Add(1))
		dialer := opts.Dialer
		gomysql.RegisterDialContext(netName, func(ctx context.Context, addr string) (net.Conn, error) {
			return dialer(ctx, "tcp", addr)
		})
		mc.Net = netName
	}

	connector, err := gomysql.NewConnector(mc)
	if err != nil {
		return nil, err
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(5)
	db.SetConnMaxIdleTime(5 * time.Minute)
	// Recycle before server wait_timeout / middlebox idle limits kill the
	// socket under us (go-sql-driver README recommendation).
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}

	s := &session{
		db:       db,
		database: cfg.Database,
		running:  map[drivers.QueryID]*runningQuery{},
		txns:     map[string]*sql.Conn{},
		cells:    drivers.NewCellCache(128),
	}
	// Vendor/version probe: MariaDB reports e.g. "11.4.2-MariaDB".
	var version string
	if err := db.QueryRowContext(ctx, "SELECT VERSION()").Scan(&version); err == nil {
		s.version = version
		s.mariadb = strings.Contains(strings.ToLower(version), "mariadb")
	}
	return s, nil
}

type runningQuery struct {
	cancel context.CancelFunc
	connID int64 // server-side connection id, for KILL QUERY
}

type session struct {
	db       *sql.DB
	database string
	version  string
	mariadb  bool
	cells    *drivers.CellCache

	mu      sync.Mutex
	running map[drivers.QueryID]*runningQuery
	txMu    sync.Mutex
	txns    map[string]*sql.Conn
}

func (s *session) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *session) Close() error {
	s.mu.Lock()
	for _, rq := range s.running {
		rq.cancel()
	}
	s.mu.Unlock()
	s.txMu.Lock()
	for id, conn := range s.txns {
		_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
		_ = conn.Close()
		delete(s.txns, id)
	}
	s.txMu.Unlock()
	return s.db.Close()
}

func (s *session) BeginTransaction(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("transaction id is required")
	}
	s.txMu.Lock()
	defer s.txMu.Unlock()
	if _, exists := s.txns[id]; exists {
		return fmt.Errorf("transaction %q is already active", id)
	}
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		conn.Close()
		return err
	}
	s.txns[id] = conn
	return nil
}

func (s *session) finishTransaction(ctx context.Context, id, statement string) error {
	s.txMu.Lock()
	conn, ok := s.txns[id]
	if ok {
		delete(s.txns, id)
	}
	s.txMu.Unlock()
	if !ok {
		return fmt.Errorf("no active transaction %q", id)
	}
	defer conn.Close()
	_, err := conn.ExecContext(ctx, statement)
	return err
}

func (s *session) CommitTransaction(ctx context.Context, id string) error {
	return s.finishTransaction(ctx, id, "COMMIT")
}

func (s *session) RollbackTransaction(ctx context.Context, id string) error {
	return s.finishTransaction(ctx, id, "ROLLBACK")
}

func (s *session) FetchCell(ref string) (*drivers.Value, bool) {
	return s.cells.Get(ref)
}

func (s *session) Cancel(ctx context.Context, queryID drivers.QueryID) error {
	s.mu.Lock()
	rq, ok := s.running[queryID]
	s.mu.Unlock()
	if !ok {
		return fmt.Errorf("no running query %q", queryID)
	}
	// Ask the server to stop the statement, then release the client side.
	// KILL QUERY keeps the connection; works on MySQL and MariaDB.
	if rq.connID != 0 {
		killCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		_, _ = s.db.ExecContext(killCtx, fmt.Sprintf("KILL QUERY %d", rq.connID))
	}
	rq.cancel()
	return nil
}

// --- Introspection -----------------------------------------------------

var systemSchemas = "'mysql', 'information_schema', 'performance_schema', 'sys'"

func (s *session) Introspect(ctx context.Context, scope drivers.IntrospectScope) (*drivers.SchemaTree, error) {
	switch {
	case scope.Table != "":
		return s.introspectColumns(ctx, scope.Schema, scope.Table)
	case scope.Category != "":
		return s.introspectCategory(ctx, scope.Schema, scope.Category)
	case scope.Schema != "":
		return s.introspectGroups(), nil
	default:
		return s.introspectSchemas(ctx)
	}
}

func (s *session) introspectGroups() *drivers.SchemaTree {
	return &drivers.SchemaTree{Nodes: []drivers.SchemaNode{
		{Kind: "group", Name: "Tables", Scope: "table", HasChildren: true},
		{Kind: "group", Name: "Views", Scope: "view", HasChildren: true},
		{Kind: "group", Name: "Routines", Scope: "routine", HasChildren: true},
		{Kind: "group", Name: "Triggers", Scope: "trigger", HasChildren: true},
	}}
}

func (s *session) introspectCategory(ctx context.Context, schema, category string) (*drivers.SchemaTree, error) {
	switch category {
	case "table", "view":
		return s.introspectRelations(ctx, schema, category)
	case "routine":
		return s.introspectRoutines(ctx, schema)
	case "trigger":
		return s.introspectTriggers(ctx, schema)
	default:
		return &drivers.SchemaTree{}, nil
	}
}

func (s *session) introspectSchemas(ctx context.Context) (*drivers.SchemaTree, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT schema_name FROM information_schema.schemata
WHERE schema_name NOT IN (`+systemSchemas+`)
ORDER BY schema_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tree := &drivers.SchemaTree{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tree.Nodes = append(tree.Nodes, drivers.SchemaNode{Kind: "schema", Name: name, HasChildren: true})
	}
	return tree, rows.Err()
}

func (s *session) introspectRelations(ctx context.Context, schema, category string) (*drivers.SchemaTree, error) {
	tableType := "BASE TABLE"
	if category == "view" {
		tableType = "VIEW"
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT table_name, table_type FROM information_schema.tables
WHERE table_schema = ? AND table_type = ?
ORDER BY table_name`, schema, tableType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tree := &drivers.SchemaTree{}
	for rows.Next() {
		var name, typ string
		if err := rows.Scan(&name, &typ); err != nil {
			return nil, err
		}
		kind := "table"
		if strings.Contains(typ, "VIEW") {
			kind = "view"
		}
		tree.Nodes = append(tree.Nodes, drivers.SchemaNode{Kind: kind, Name: name, HasChildren: true})
	}
	return tree, rows.Err()
}

func (s *session) introspectRoutines(ctx context.Context, schema string) (*drivers.SchemaTree, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT routine_name, routine_type FROM information_schema.routines
WHERE routine_schema = ? ORDER BY routine_name`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tree := &drivers.SchemaTree{}
	for rows.Next() {
		var name, typ string
		if err := rows.Scan(&name, &typ); err != nil {
			return nil, err
		}
		tree.Nodes = append(tree.Nodes, drivers.SchemaNode{Kind: "routine", Name: name, Detail: strings.ToLower(typ)})
	}
	return tree, rows.Err()
}

func (s *session) introspectTriggers(ctx context.Context, schema string) (*drivers.SchemaTree, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT trigger_name, event_object_table FROM information_schema.triggers
WHERE trigger_schema = ? ORDER BY trigger_name`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tree := &drivers.SchemaTree{}
	for rows.Next() {
		var name, table string
		if err := rows.Scan(&name, &table); err != nil {
			return nil, err
		}
		tree.Nodes = append(tree.Nodes, drivers.SchemaNode{Kind: "trigger", Name: name, Detail: table})
	}
	return tree, rows.Err()
}

func (s *session) introspectColumns(ctx context.Context, schema, table string) (*drivers.SchemaTree, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT column_name, column_type FROM information_schema.columns
WHERE table_schema = ? AND table_name = ?
ORDER BY ordinal_position`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tree := &drivers.SchemaTree{}
	for rows.Next() {
		var name, typ string
		if err := rows.Scan(&name, &typ); err != nil {
			return nil, err
		}
		tree.Nodes = append(tree.Nodes, drivers.SchemaNode{Kind: "column", Name: name, Detail: typ})
	}
	return tree, rows.Err()
}

// ListServerDatabases returns the user databases on the server.
func (s *session) ListServerDatabases(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT schema_name FROM information_schema.schemata
WHERE schema_name NOT IN (`+systemSchemas+`)
ORDER BY schema_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

// AutocompleteMap returns "schema.table" → columns for the editor.
func (s *session) AutocompleteMap(ctx context.Context) (map[string][]string, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE table_schema NOT IN (`+systemSchemas+`)
ORDER BY table_schema, table_name, ordinal_position`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var schema, table, col string
		if err := rows.Scan(&schema, &table, &col); err != nil {
			return nil, err
		}
		key := schema + "." + table
		out[key] = append(out[key], col)
	}
	return out, rows.Err()
}

// --- Execution ----------------------------------------------------------

// returnsRows decides Query vs Exec: database/sql exposes RowsAffected
// only through Exec, and result sets only through Query.
func returnsRows(statement string) bool {
	head := strings.ToLower(strings.TrimSpace(statement))
	for _, kw := range []string{"select", "show", "describe", "desc ", "explain", "with", "table ", "values"} {
		if strings.HasPrefix(head, kw) {
			return true
		}
	}
	return false
}

func (s *session) Execute(ctx context.Context, req drivers.QueryRequest, sink drivers.RowSink) (*drivers.QuerySummary, error) {
	qctx, cancel := context.WithCancel(ctx)
	defer cancel()

	start := time.Now()
	summary := &drivers.QuerySummary{QueryID: req.QueryID}
	finish := func(err error) (*drivers.QuerySummary, error) {
		summary.DurationMs = time.Since(start).Milliseconds()
		if err != nil {
			// User-initiated cancel: client context cancellation, or
			// MySQL error 1317 (ER_QUERY_INTERRUPTED) when KILL QUERY won.
			if errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "1317") {
				summary.Error = "cancelled"
			} else {
				summary.Error = err.Error()
			}
		}
		return summary, nil
	}

	var conn *sql.Conn
	if req.TransactionID != "" {
		s.txMu.Lock()
		defer s.txMu.Unlock()
		conn = s.txns[req.TransactionID]
		if conn == nil {
			return finish(fmt.Errorf("no active transaction %q", req.TransactionID))
		}
	} else {
		var err error
		conn, err = s.db.Conn(qctx)
		if err != nil {
			return finish(err)
		}
		defer conn.Close()
	}
	restoreContext, err := applySchemaContext(qctx, conn, req.SchemaContext)
	if err != nil {
		return finish(err)
	}
	defer restoreContext()

	// Pin the server-side connection id so Cancel can KILL QUERY it.
	var connID int64
	_ = conn.QueryRowContext(qctx, "SELECT CONNECTION_ID()").Scan(&connID)
	s.mu.Lock()
	s.running[req.QueryID] = &runningQuery{cancel: cancel, connID: connID}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.running, req.QueryID)
		s.mu.Unlock()
	}()

	if !returnsRows(req.Statement) {
		res, err := conn.ExecContext(qctx, req.Statement, req.Args...)
		if err != nil {
			return finish(err)
		}
		if n, err := res.RowsAffected(); err == nil {
			summary.RowsAffected = n
		}
		// Emit an empty first batch so the frontend sees completion shape.
		drivers.NewBatcher(req.QueryID, nil, sink).Flush()
		return finish(nil)
	}

	rows, err := conn.QueryContext(qctx, req.Statement, req.Args...)
	if err != nil {
		return finish(err)
	}
	defer rows.Close()

	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return finish(err)
	}
	columns := make([]drivers.Column, len(colTypes))
	for i, ct := range colTypes {
		columns[i] = drivers.Column{Name: ct.Name(), TypeName: strings.ToLower(ct.DatabaseTypeName())}
	}

	enc := encoder{cells: s.cells, queryID: req.QueryID, types: colTypes}
	batcher := drivers.NewBatcher(req.QueryID, columns, sink)
	raw := make([]any, len(colTypes))
	ptrs := make([]any, len(colTypes))
	for i := range raw {
		ptrs[i] = &raw[i]
	}

	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return finish(err)
		}
		row := make([]any, len(raw))
		for i, v := range raw {
			row[i] = enc.encode(i, v)
		}
		batcher.Add(row)
		summary.RowsReturned++

		if req.MaxRows > 0 && summary.RowsReturned >= int64(req.MaxRows) {
			summary.Truncated = true
			cancel() // stop the server sending the tail
			break
		}
	}
	if err := rows.Err(); err != nil && !summary.Truncated {
		batcher.Flush()
		return finish(err)
	}
	batcher.Flush()
	return finish(nil)
}
