package postgres

// Integration test against a local Postgres, gated on DATAGRID_TEST_PG=1 so
// CI stays hermetic. Setup (see docs/ and the pg-test-setup notes):
//
//	brew install postgresql@16 && brew services start postgresql@16
//	createdb datagrid_test  (seeded with app.users 25k rows + public.notes)
//
// Run:
//
//	DATAGRID_TEST_PG=1 PGDATABASE=datagrid_test PGHOST=localhost go test ./internal/drivers/postgres/
//
// Honors PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.

import (
	"context"
	"os"
	"os/user"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"datagrid/internal/drivers"
)

func testSession(t *testing.T) drivers.Session {
	t.Helper()
	if os.Getenv("DATAGRID_TEST_PG") != "1" {
		t.Skip("set DATAGRID_TEST_PG=1 to run Postgres integration tests")
	}
	host := os.Getenv("PGHOST")
	if host == "" {
		host = "localhost"
	}
	port := 5432
	if p := os.Getenv("PGPORT"); p != "" {
		port, _ = strconv.Atoi(p)
	}
	db := os.Getenv("PGDATABASE")
	if db == "" {
		db = "datagrid_test"
	}
	usr := os.Getenv("PGUSER")
	if usr == "" {
		if u, err := user.Current(); err == nil {
			usr = u.Username
		}
	}

	d, err := drivers.Get(drivers.EnginePostgres)
	if err != nil {
		t.Fatal(err)
	}
	sess, err := d.Connect(context.Background(), &drivers.ConnectionConfig{
		Engine:   drivers.EnginePostgres,
		Host:     host,
		Port:     port,
		Database: db,
		User:     usr,
		TLSMode:  "disable",
	}, drivers.ConnectOptions{Password: os.Getenv("PGPASSWORD")})
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

func TestIntrospect(t *testing.T) {
	sess := testSession(t)
	ctx := context.Background()

	schemas, err := sess.Introspect(ctx, drivers.IntrospectScope{})
	if err != nil {
		t.Fatalf("schemas: %v", err)
	}
	if !slices.Contains(names(schemas.Nodes), "app") || !slices.Contains(names(schemas.Nodes), "public") {
		t.Fatalf("expected app and public schemas, got %v", names(schemas.Nodes))
	}

	groups, err := sess.Introspect(ctx, drivers.IntrospectScope{Schema: "app"})
	if err != nil {
		t.Fatalf("groups: %v", err)
	}
	if !slices.Contains(names(groups.Nodes), "Tables") || !slices.Contains(names(groups.Nodes), "Routines") {
		t.Fatalf("expected grouped schema nodes, got %v", names(groups.Nodes))
	}
	tables, err := sess.Introspect(ctx, drivers.IntrospectScope{Schema: "app", Category: "table"})
	if err != nil {
		t.Fatalf("tables: %v", err)
	}
	views, err := sess.Introspect(ctx, drivers.IntrospectScope{Schema: "app", Category: "view"})
	if err != nil {
		t.Fatalf("views: %v", err)
	}
	var kinds = map[string]string{}
	for _, n := range append(tables.Nodes, views.Nodes...) {
		kinds[n.Name] = n.Kind
	}
	if kinds["users"] != "table" {
		t.Errorf("app.users: want table, got %q", kinds["users"])
	}
	if kinds["active_users"] != "view" {
		t.Errorf("app.active_users: want view, got %q", kinds["active_users"])
	}

	cols, err := sess.Introspect(ctx, drivers.IntrospectScope{Schema: "app", Table: "users"})
	if err != nil {
		t.Fatalf("columns: %v", err)
	}
	if len(cols.Nodes) < 5 {
		t.Fatalf("expected several columns on app.users, got %d", len(cols.Nodes))
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
		Statement: "SELECT * FROM app.users ORDER BY id",
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
		t.Errorf("expected ≥50 batches of ≤500 rows, got %d", len(batches))
	}
	if len(batches[0].Columns) == 0 {
		t.Error("first batch missing column metadata")
	}
	for i, b := range batches {
		if b.Seq != i {
			t.Fatalf("batch %d has seq %d", i, b.Seq)
		}
	}

	// Spot-check tagged values on the first row: id is i64, at least one
	// bool and one time-tagged cell exist across the row.
	row := batches[0].Rows[0]
	first, ok := row[0].(drivers.Value)
	if !ok || first.T != "i64" {
		t.Errorf("first cell: want tagged i64, got %#v", row[0])
	}
	tags := map[string]bool{}
	for _, c := range row {
		if v, ok := c.(drivers.Value); ok {
			tags[v.T] = true
		}
	}
	for _, want := range []string{"bool", "time", "json"} {
		if !tags[want] {
			t.Errorf("expected a %q-tagged cell in app.users row, tags seen: %v", want, tags)
		}
	}
}

func TestObjectDDL(t *testing.T) {
	sess := testSession(t)
	provider := sess.(drivers.ObjectDefiner)
	ddl, err := provider.ObjectDDL(context.Background(), "table", "app", "users")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ddl, `CREATE TABLE "app"."users"`) || !strings.Contains(ddl, "PRIMARY KEY") {
		t.Fatalf("unexpected table DDL: %s", ddl)
	}
	view, err := provider.ObjectDDL(context.Background(), "view", "app", "active_users")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(view, `VIEW "app"."active_users"`) {
		t.Fatalf("unexpected view DDL: %s", view)
	}
}

func TestMaxRowsTruncation(t *testing.T) {
	sess := testSession(t)

	rows := 0
	summary, err := sess.Execute(context.Background(), drivers.QueryRequest{
		QueryID:   "q-maxrows",
		Statement: "SELECT * FROM app.users",
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
		Statement: "SELECT body FROM public.notes ORDER BY length(body) DESC LIMIT 1",
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
	if len(full.V.(string)) <= drivers.CellTruncateAt {
		t.Errorf("full value should exceed %d chars, got %d", drivers.CellTruncateAt, len(full.V.(string)))
	}
	if !strings.HasPrefix(full.V.(string), cell.V.(string)) {
		t.Error("truncated value is not a prefix of the full value")
	}
}

func TestCancel(t *testing.T) {
	sess := testSession(t)

	done := make(chan *drivers.QuerySummary, 1)
	go func() {
		summary, _ := sess.Execute(context.Background(), drivers.QueryRequest{
			QueryID:   "q-cancel",
			Statement: "SELECT pg_sleep(30)",
		}, func(drivers.RowBatch) {})
		done <- summary
	}()

	time.Sleep(300 * time.Millisecond) // let the query reach the server
	if err := sess.Cancel(context.Background(), "q-cancel"); err != nil {
		t.Fatalf("cancel: %v", err)
	}

	select {
	case summary := <-done:
		if summary.Error == "" {
			t.Error("cancelled query should report an error")
		}
		if summary.DurationMs > 5000 {
			t.Errorf("cancel took too long: %dms", summary.DurationMs)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("query did not stop within 5s of cancel")
	}
}
