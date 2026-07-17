// Package postgres implements the drivers.Driver interface on pgx v5.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"datagrid/internal/drivers"
)

func init() {
	drivers.Register(drivers.EnginePostgres, &pgDriver{})
}

type pgDriver struct{}

func (d *pgDriver) Capabilities() drivers.Capabilities {
	return drivers.Capabilities{SQL: true, MultipleDatabases: true}
}

// quoteDSN escapes a value for a keyword/value conninfo string.
func quoteDSN(v string) string {
	v = strings.ReplaceAll(v, `\`, `\\`)
	v = strings.ReplaceAll(v, `'`, `\'`)
	return "'" + v + "'"
}

func quoteSearchPathItem(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func applySchemaContext(ctx context.Context, conn *pgxpool.Conn, schemas []string) (func(), error) {
	if len(schemas) == 0 {
		return func() {}, nil
	}
	var previous string
	if err := conn.QueryRow(ctx, "SELECT current_setting('search_path')").Scan(&previous); err != nil {
		return nil, err
	}
	items := make([]string, 0, len(schemas))
	for _, schema := range schemas {
		if strings.TrimSpace(schema) != "" {
			items = append(items, quoteSearchPathItem(schema))
		}
	}
	if len(items) == 0 {
		return func() {}, nil
	}
	if _, err := conn.Exec(ctx, "SELECT set_config('search_path', $1, false)", strings.Join(items, ", ")); err != nil {
		return nil, err
	}
	return func() {
		restoreCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = conn.Exec(restoreCtx, "SELECT set_config('search_path', $1, false)", previous)
	}, nil
}

func (d *pgDriver) Connect(ctx context.Context, cfg *drivers.ConnectionConfig, opts drivers.ConnectOptions) (drivers.Session, error) {
	port := cfg.Port
	if port == 0 {
		port = 5432
	}
	sslmode := cfg.TLSMode
	if sslmode == "" {
		sslmode = "prefer"
	}
	dsn := fmt.Sprintf("host=%s port=%d dbname=%s user=%s sslmode=%s",
		quoteDSN(cfg.Host), port, quoteDSN(cfg.Database), quoteDSN(cfg.User), sslmode)
	if opts.Password != "" {
		dsn += " password=" + quoteDSN(opts.Password)
	}

	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	poolCfg.MaxConns = 5
	poolCfg.MinConns = 0
	poolCfg.MaxConnIdleTime = 5 * time.Minute
	// Fail fast when the host is unreachable rather than hanging on the dial.
	poolCfg.ConnConfig.ConnectTimeout = 10 * time.Second
	if opts.Dialer != nil {
		poolCfg.ConnConfig.DialFunc = opts.Dialer
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &session{
		pool:    pool,
		running: map[drivers.QueryID]context.CancelFunc{},
		txns:    map[string]*pgxpool.Conn{},
		cells:   drivers.NewCellCache(128),
	}, nil
}

type session struct {
	pool  *pgxpool.Pool
	cells *drivers.CellCache

	mu      sync.Mutex
	running map[drivers.QueryID]context.CancelFunc
	txMu    sync.Mutex
	txns    map[string]*pgxpool.Conn
}

func (s *session) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *session) Close() error {
	s.mu.Lock()
	for _, cancel := range s.running {
		cancel()
	}
	s.mu.Unlock()
	s.txMu.Lock()
	for id, conn := range s.txns {
		_, _ = conn.Exec(context.Background(), "ROLLBACK")
		conn.Release()
		delete(s.txns, id)
	}
	s.txMu.Unlock()
	s.pool.Close()
	return nil
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
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, "BEGIN"); err != nil {
		conn.Release()
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
	defer conn.Release()
	_, err := conn.Exec(ctx, statement)
	return err
}

func (s *session) CommitTransaction(ctx context.Context, id string) error {
	return s.finishTransaction(ctx, id, "COMMIT")
}

func (s *session) RollbackTransaction(ctx context.Context, id string) error {
	return s.finishTransaction(ctx, id, "ROLLBACK")
}

func (s *session) Cancel(_ context.Context, queryID drivers.QueryID) error {
	s.mu.Lock()
	cancel, ok := s.running[queryID]
	s.mu.Unlock()
	if !ok {
		return fmt.Errorf("no running query %q", queryID)
	}
	// pgx sends a server-side cancel request on context cancellation.
	cancel()
	return nil
}

func (s *session) FetchCell(ref string) (*drivers.Value, bool) {
	return s.cells.Get(ref)
}

// ListServerDatabases returns the non-template databases on the server.
func (s *session) ListServerDatabases(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname`)
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
	rows, err := s.pool.Query(ctx, `
SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
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

// --- Introspection -----------------------------------------------------

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
		{Kind: "group", Name: "Sequences", Scope: "sequence", HasChildren: true},
		{Kind: "group", Name: "Triggers", Scope: "trigger", HasChildren: true},
	}}
}

func (s *session) introspectCategory(ctx context.Context, schema, category string) (*drivers.SchemaTree, error) {
	switch category {
	case "table", "view":
		return s.introspectRelations(ctx, schema, category)
	case "routine":
		return s.introspectRoutines(ctx, schema)
	case "sequence":
		return s.introspectSequences(ctx, schema)
	case "trigger":
		return s.introspectTriggers(ctx, schema)
	default:
		return &drivers.SchemaTree{}, nil
	}
}

func (s *session) introspectSchemas(ctx context.Context) (*drivers.SchemaTree, error) {
	rows, err := s.pool.Query(ctx, `
SELECT nspname FROM pg_catalog.pg_namespace
WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg\_%'
ORDER BY nspname`)
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
	relkinds := "'r', 'p'"
	if category == "view" {
		relkinds = "'v', 'm'"
	}
	rows, err := s.pool.Query(ctx, `
SELECT c.relname, c.relkind::text
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relkind IN (`+relkinds+`)
ORDER BY c.relname`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tree := &drivers.SchemaTree{}
	for rows.Next() {
		var name, relkind string
		if err := rows.Scan(&name, &relkind); err != nil {
			return nil, err
		}
		kind := "table"
		if relkind == "v" || relkind == "m" {
			kind = "view"
		}
		tree.Nodes = append(tree.Nodes, drivers.SchemaNode{Kind: kind, Name: name, HasChildren: true})
	}
	return tree, rows.Err()
}

func (s *session) introspectRoutines(ctx context.Context, schema string) (*drivers.SchemaTree, error) {
	rows, err := s.pool.Query(ctx, `SELECT p.proname, pg_catalog.pg_get_function_result(p.oid)
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1 ORDER BY p.proname`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tree := &drivers.SchemaTree{}
	for rows.Next() {
		var name, result string
		if err := rows.Scan(&name, &result); err != nil {
			return nil, err
		}
		tree.Nodes = append(tree.Nodes, drivers.SchemaNode{Kind: "routine", Name: name, Detail: result})
	}
	return tree, rows.Err()
}

func (s *session) introspectSequences(ctx context.Context, schema string) (*drivers.SchemaTree, error) {
	rows, err := s.pool.Query(ctx, `SELECT c.relname FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relkind = 'S' ORDER BY c.relname`, schema)
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
		tree.Nodes = append(tree.Nodes, drivers.SchemaNode{Kind: "sequence", Name: name})
	}
	return tree, rows.Err()
}

func (s *session) introspectTriggers(ctx context.Context, schema string) (*drivers.SchemaTree, error) {
	rows, err := s.pool.Query(ctx, `SELECT t.tgname, c.relname FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY t.tgname`, schema)
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
	rows, err := s.pool.Query(ctx, `
SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum`, schema, table)
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

// --- Execution ----------------------------------------------------------

func (s *session) Execute(ctx context.Context, req drivers.QueryRequest, sink drivers.RowSink) (*drivers.QuerySummary, error) {
	qctx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.mu.Lock()
	s.running[req.QueryID] = cancel
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.running, req.QueryID)
		s.mu.Unlock()
	}()

	start := time.Now()
	summary := &drivers.QuerySummary{QueryID: req.QueryID}
	finish := func(err error) (*drivers.QuerySummary, error) {
		summary.DurationMs = time.Since(start).Milliseconds()
		if err != nil {
			// User-initiated cancel: context cancellation client-side, or
			// SQLSTATE 57014 (query_canceled) when the server won the race.
			if errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "57014") {
				summary.Error = "cancelled"
			} else {
				summary.Error = err.Error()
			}
		}
		return summary, nil
	}

	var conn *pgxpool.Conn
	if req.TransactionID != "" {
		s.txMu.Lock()
		defer s.txMu.Unlock()
		conn = s.txns[req.TransactionID]
		if conn == nil {
			return finish(fmt.Errorf("no active transaction %q", req.TransactionID))
		}
	} else {
		var err error
		conn, err = s.pool.Acquire(qctx)
		if err != nil {
			return finish(err)
		}
		defer conn.Release()
	}
	restoreContext, err := applySchemaContext(qctx, conn, req.SchemaContext)
	if err != nil {
		return finish(err)
	}
	defer restoreContext()

	rows, err := conn.Query(qctx, req.Statement, req.Args...)
	if err != nil {
		return finish(err)
	}
	defer rows.Close()

	typeMap := conn.Conn().TypeMap()
	var columns []drivers.Column
	for _, fd := range rows.FieldDescriptions() {
		typeName := fmt.Sprintf("oid:%d", fd.DataTypeOID)
		if t, ok := typeMap.TypeForOID(fd.DataTypeOID); ok {
			typeName = t.Name
		}
		columns = append(columns, drivers.Column{Name: fd.Name, TypeName: typeName})
	}

	enc := encoder{cells: s.cells, queryID: req.QueryID}
	batcher := drivers.NewBatcher(req.QueryID, columns, sink)

	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			rows.Close()
			return finish(err)
		}
		row := make([]any, len(vals))
		for i, v := range vals {
			row[i] = enc.encode(v)
		}
		batcher.Add(row)
		summary.RowsReturned++

		if req.MaxRows > 0 && summary.RowsReturned >= int64(req.MaxRows) {
			summary.Truncated = true
			// Cancel server-side so rows.Close doesn't drain a huge tail.
			cancel()
			break
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil && !summary.Truncated {
		batcher.Flush()
		return finish(err)
	}
	summary.RowsAffected = rows.CommandTag().RowsAffected()
	batcher.Flush()
	return finish(nil)
}
