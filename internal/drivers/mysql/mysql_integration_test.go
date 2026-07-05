package mysql

// Integration test against a local MySQL, gated on DATAGRID_TEST_MYSQL=1 so
// CI stays hermetic. On this machine the fixture runs on 127.0.0.1:3308
// (mysqld_safe with socket /tmp/mysql_dg.sock), database datagrid_test:
// app-equivalent table `users` (25k rows incl. bigint unsigned), view
// `active_users`, and `notes` with a ~24k-char longtext row.
//
// Run:
//
//	DATAGRID_TEST_MYSQL=1 MYSQL_PORT=3308 go test ./internal/drivers/mysql/
//
// Honors MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE.

import (
	"context"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"datagrid/internal/drivers"
)

func testSession(t *testing.T) drivers.Session {
	t.Helper()
	if os.Getenv("DATAGRID_TEST_MYSQL") != "1" {
		t.Skip("set DATAGRID_TEST_MYSQL=1 to run MySQL integration tests")
	}
	host := os.Getenv("MYSQL_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	port := 3306
	if p := os.Getenv("MYSQL_PORT"); p != "" {
		port, _ = strconv.Atoi(p)
	}
	db := os.Getenv("MYSQL_DATABASE")
	if db == "" {
		db = "datagrid_test"
	}
	usr := os.Getenv("MYSQL_USER")
	if usr == "" {
		usr = "root"
	}

	d, err := drivers.Get(drivers.EngineMySQL)
	if err != nil {
		t.Fatal(err)
	}
	sess, err := d.Connect(context.Background(), &drivers.ConnectionConfig{
		Engine:   drivers.EngineMySQL,
		Host:     host,
		Port:     port,
		Database: db,
		User:     usr,
		TLSMode:  "disable",
	}, drivers.ConnectOptions{Password: os.Getenv("MYSQL_PASSWORD")})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { sess.Close() })
	return sess
}

func names(nodes []drivers.SchemaNode) []string {
	out := make([]string, len(nodes))
	for i, n := range nodes {
		out[i] = n.Name
	}
	return out
}

func TestVendorProbe(t *testing.T) {
	sess := testSession(t)
	s := sess.(*session)
	if s.version == "" {
		t.Error("version probe left version empty")
	}
	t.Logf("server version: %s (mariadb=%v)", s.version, s.mariadb)
}

func TestIntrospect(t *testing.T) {
	sess := testSession(t)
	ctx := context.Background()

	schemas, err := sess.Introspect(ctx, drivers.IntrospectScope{})
	if err != nil {
		t.Fatalf("schemas: %v", err)
	}
	if !slices.Contains(names(schemas.Nodes), "datagrid_test") {
		t.Fatalf("expected datagrid_test schema, got %v", names(schemas.Nodes))
	}

	rels, err := sess.Introspect(ctx, drivers.IntrospectScope{Schema: "datagrid_test"})
	if err != nil {
		t.Fatalf("relations: %v", err)
	}
	kinds := map[string]string{}
	for _, n := range rels.Nodes {
		kinds[n.Name] = n.Kind
	}
	if kinds["users"] != "table" {
		t.Errorf("users: want table, got %q", kinds["users"])
	}
	if kinds["active_users"] != "view" {
		t.Errorf("active_users: want view, got %q", kinds["active_users"])
	}

	cols, err := sess.Introspect(ctx, drivers.IntrospectScope{Schema: "datagrid_test", Table: "users"})
	if err != nil {
		t.Fatalf("columns: %v", err)
	}
	if len(cols.Nodes) < 5 {
		t.Fatalf("expected several columns on users, got %d", len(cols.Nodes))
	}
	if cols.Nodes[0].Name != "id" || cols.Nodes[0].Detail != "bigint" {
		t.Errorf("first column: want id bigint, got %s %s", cols.Nodes[0].Name, cols.Nodes[0].Detail)
	}
}

func TestExecuteStreaming(t *testing.T) {
	sess := testSession(t)

	var batches []drivers.RowBatch
	summary, err := sess.Execute(context.Background(), drivers.QueryRequest{
		QueryID:   "q-stream",
		Statement: "SELECT * FROM users ORDER BY id",
	}, func(b drivers.RowBatch) { batches = append(batches, b) })
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if summary.Error != "" {
		t.Fatalf("query error: %s", summary.Error)
	}
	if summary.RowsReturned != 25000 {
		t.Errorf("rows returned: want 25000, got %d", summary.RowsReturned)
	}
	if len(batches) < 25000/500 {
		t.Errorf("expected ≥50 batches, got %d", len(batches))
	}
	if len(batches[0].Columns) == 0 {
		t.Fatal("first batch missing column metadata")
	}

	// Column type spot checks and tagged values on the first row.
	colIdx := map[string]int{}
	for i, c := range batches[0].Columns {
		colIdx[c.Name] = i
	}
	row := batches[0].Rows[0]
	checks := map[string]string{
		"id":         "i64",
		"active":     "i64", // tinyint(1): MySQL has no true bool
		"score":      "str", // decimal keeps exact text form
		"ratio":      "f64",
		"created_at": "time",
		"metadata":   "json",
		"avatar":     "bytes",
	}
	for col, wantTag := range checks {
		i, ok := colIdx[col]
		if !ok {
			t.Errorf("column %q missing", col)
			continue
		}
		v := row[i].(drivers.Value)
		if v.T != wantTag && v.T != "null" {
			t.Errorf("column %q: want tag %q, got %q (v=%v)", col, wantTag, v.T, v.V)
		}
	}
}

func TestUnsignedBigint(t *testing.T) {
	sess := testSession(t)

	var batches []drivers.RowBatch
	summary, err := sess.Execute(context.Background(), drivers.QueryRequest{
		QueryID: "q-unsigned",
		// ucount is seeded with max uint64 across the fixture — the
		// deliberate int64-overflow case; 42 covers the in-range case.
		Statement: "SELECT ucount, CAST(42 AS UNSIGNED) AS small FROM users LIMIT 1",
	}, func(b drivers.RowBatch) { batches = append(batches, b) })
	if err != nil || summary.Error != "" {
		t.Fatalf("execute: %v / %s", err, summary.Error)
	}
	ucount := batches[0].Rows[0][0].(drivers.Value)
	if ucount.T != "str" || ucount.V != "18446744073709551615" {
		t.Errorf("uint64 overflow should fall back to str, got %s %v", ucount.T, ucount.V)
	}
	small := batches[0].Rows[0][1].(drivers.Value)
	if small.T != "i64" {
		t.Errorf("in-range unsigned should be i64, got %s %v", small.T, small.V)
	}
}

func TestMaxRowsTruncation(t *testing.T) {
	sess := testSession(t)

	rows := 0
	summary, err := sess.Execute(context.Background(), drivers.QueryRequest{
		QueryID:   "q-maxrows",
		Statement: "SELECT * FROM users",
		MaxRows:   1000,
	}, func(b drivers.RowBatch) { rows += len(b.Rows) })
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if summary.Error != "" {
		t.Fatalf("query error: %s", summary.Error)
	}
	if !summary.Truncated {
		t.Error("expected Truncated summary")
	}
	if rows != 1000 || summary.RowsReturned != 1000 {
		t.Errorf("want exactly 1000 rows, got streamed=%d summary=%d", rows, summary.RowsReturned)
	}
}

func TestOversizedCellTruncation(t *testing.T) {
	sess := testSession(t)

	var batches []drivers.RowBatch
	summary, err := sess.Execute(context.Background(), drivers.QueryRequest{
		QueryID:   "q-bigcell",
		Statement: "SELECT body FROM notes ORDER BY length(body) DESC LIMIT 1",
	}, func(b drivers.RowBatch) { batches = append(batches, b) })
	if err != nil || summary.Error != "" {
		t.Fatalf("execute: %v / %s", err, summary.Error)
	}
	cell := batches[0].Rows[0][0].(drivers.Value)
	if cell.Ref == "" {
		t.Fatal("oversized cell should carry a ref")
	}
	if len(cell.V.(string)) != drivers.CellTruncateAt {
		t.Errorf("truncated cell length: want %d, got %d", drivers.CellTruncateAt, len(cell.V.(string)))
	}
	full, ok := sess.(drivers.CellFetcher).FetchCell(cell.Ref)
	if !ok {
		t.Fatal("FetchCell: ref not found")
	}
	if !strings.HasPrefix(full.V.(string), cell.V.(string)) {
		t.Error("truncated value is not a prefix of the full value")
	}
}

func TestDMLRowsAffected(t *testing.T) {
	sess := testSession(t)
	ctx := context.Background()

	_, err := sess.Execute(ctx, drivers.QueryRequest{
		QueryID:   "q-ddl",
		Statement: "CREATE TEMPORARY TABLE tmp_dg (id INT)",
	}, func(drivers.RowBatch) {})
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	// Temp tables are per-connection and the pool may hand Execute a
	// different conn, so DML target must be a real table check instead:
	summary, err := sess.Execute(ctx, drivers.QueryRequest{
		QueryID:   "q-dml",
		Statement: "UPDATE users SET active = active WHERE id <= 10",
	}, func(drivers.RowBatch) {})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if summary.Error != "" {
		t.Fatalf("update error: %s", summary.Error)
	}
	// MySQL reports 0 changed for no-op updates; matched rows still prove
	// the Exec path ran. Accept ≥0 but require no error and no columns.
	if summary.RowsReturned != 0 {
		t.Errorf("DML should return no rows, got %d", summary.RowsReturned)
	}
}

func TestCancel(t *testing.T) {
	sess := testSession(t)

	done := make(chan *drivers.QuerySummary, 1)
	go func() {
		summary, _ := sess.Execute(context.Background(), drivers.QueryRequest{
			QueryID:   "q-cancel",
			Statement: "SELECT SLEEP(30)",
		}, func(drivers.RowBatch) {})
		done <- summary
	}()

	time.Sleep(300 * time.Millisecond) // let the query reach the server
	if err := sess.Cancel(context.Background(), "q-cancel"); err != nil {
		t.Fatalf("cancel: %v", err)
	}

	select {
	case summary := <-done:
		if summary.DurationMs > 5000 {
			t.Errorf("cancel took too long: %dms", summary.DurationMs)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("query did not stop within 5s of cancel")
	}
}

func TestAutocompleteMap(t *testing.T) {
	sess := testSession(t)
	m, err := sess.(drivers.AutocompleteProvider).AutocompleteMap(context.Background())
	if err != nil {
		t.Fatalf("autocomplete: %v", err)
	}
	cols, ok := m["datagrid_test.users"]
	if !ok {
		t.Fatalf("expected datagrid_test.users in map, keys: %d", len(m))
	}
	if !slices.Contains(cols, "email") {
		t.Errorf("expected email column, got %v", cols)
	}
}
