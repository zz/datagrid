package postgres

import (
	"context"
	"slices"
	"testing"

	"datagrid/internal/drivers"
)

func TestTableInfoPK(t *testing.T) {
	sess := testSession(t)
	te := sess.(drivers.TableEditor)

	info, err := te.TableInfo(context.Background(), "app", "users")
	if err != nil {
		t.Fatalf("table info: %v", err)
	}
	if !slices.Equal(info.PrimaryKey, []string{"id"}) {
		t.Errorf("primary key: want [id], got %v", info.PrimaryKey)
	}
	if len(info.Columns) < 5 {
		t.Errorf("want several columns, got %d", len(info.Columns))
	}
	if !slices.ContainsFunc(info.Constraints, func(c drivers.ConstraintInfo) bool { return c.Kind == "primary_key" }) {
		t.Errorf("expected primary-key constraint, got %#v", info.Constraints)
	}
	if len(info.Indexes) == 0 {
		t.Error("expected table indexes")
	}
	// id is NOT NULL.
	for _, c := range info.Columns {
		if c.Name == "id" && c.Nullable {
			t.Error("id should be NOT NULL")
		}
	}
}

func TestReadPageSortFilterPaging(t *testing.T) {
	sess := testSession(t)
	te := sess.(drivers.TableEditor)
	ctx := context.Background()

	// Descending by id, first page of 10.
	page, err := te.ReadPage(ctx, drivers.PageRequest{
		Schema: "app", Table: "users",
		Sorts: []drivers.SortSpec{{Column: "id", Desc: true}},
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("read page: %v", err)
	}
	if len(page.Rows) != 10 {
		t.Fatalf("want 10 rows, got %d", len(page.Rows))
	}
	if !page.HasMore {
		t.Error("expected HasMore on first page of 25k")
	}
	first := page.Rows[0][0].(drivers.Value)
	if first.V != int64(25000) {
		t.Errorf("first id desc: want 25000, got %v", first.V)
	}

	// Filter by exact id.
	page, err = te.ReadPage(ctx, drivers.PageRequest{
		Schema: "app", Table: "users",
		Filters: []drivers.FilterSpec{{Column: "id", Op: "=", Value: "42"}},
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("filtered read: %v", err)
	}
	if len(page.Rows) != 1 || page.Rows[0][0].(drivers.Value).V != int64(42) {
		t.Errorf("filter id=42 returned %d rows", len(page.Rows))
	}
}

// TestApplyChangesRoundTrip inserts, updates, then deletes a row in the real
// table and verifies each step, leaving the table as it was found.
func TestApplyChangesRoundTrip(t *testing.T) {
	sess := testSession(t)
	te := sess.(drivers.TableEditor)
	ctx := context.Background()

	const email = "m3-roundtrip@example.com"

	// Insert (id is bigserial/default, so omit it).
	ins, err := te.ApplyChanges(ctx, drivers.ChangesetRequest{
		Schema: "app", Table: "users",
		Changes: []drivers.RowChange{{Kind: "insert", Set: map[string]drivers.CellInput{
			"email": {Text: email}, "active": {Text: "true"}, "score": {Text: "1.5"},
		}}},
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if ins.RowsAffected != 1 {
		t.Errorf("insert affected %d rows", ins.RowsAffected)
	}

	// Find the new row's id.
	page, err := te.ReadPage(ctx, drivers.PageRequest{
		Schema: "app", Table: "users",
		Filters: []drivers.FilterSpec{{Column: "email", Op: "=", Value: email}},
	})
	if err != nil || len(page.Rows) != 1 {
		t.Fatalf("lookup inserted row: %v (rows=%d)", err, len(page.Rows))
	}
	var idCol int
	for i, c := range page.Columns {
		if c.Name == "id" {
			idCol = i
		}
	}
	id := page.Rows[0][idCol].(drivers.Value)
	idText := toText(t, id)

	// A stale original value must roll back instead of overwriting the row.
	stale, err := te.ApplyChanges(ctx, drivers.ChangesetRequest{
		Schema: "app", Table: "users",
		Changes: []drivers.RowChange{{Kind: "update",
			Set:      map[string]drivers.CellInput{"score": {Text: "8.88"}},
			Key:      map[string]drivers.CellInput{"id": {Text: idText}},
			Original: map[string]drivers.CellInput{"score": {Text: "999"}},
		}},
	})
	if err != nil {
		t.Fatalf("stale update: %v", err)
	}
	if stale.RowsAffected != 0 || len(stale.Conflicts) != 1 {
		t.Fatalf("stale update result = %+v", stale)
	}

	// Update the score.
	upd, err := te.ApplyChanges(ctx, drivers.ChangesetRequest{
		Schema: "app", Table: "users",
		Changes: []drivers.RowChange{{Kind: "update",
			Set: map[string]drivers.CellInput{"score": {Text: "9.99"}},
			Key: map[string]drivers.CellInput{"id": {Text: idText}},
		}},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if upd.RowsAffected != 1 {
		t.Errorf("update affected %d rows", upd.RowsAffected)
	}
	if len(upd.Previews) != 1 || upd.Previews[0] == "" {
		t.Error("expected a generated SQL preview")
	}

	// Delete it, restoring the table.
	del, err := te.ApplyChanges(ctx, drivers.ChangesetRequest{
		Schema: "app", Table: "users",
		Changes: []drivers.RowChange{{Kind: "delete",
			Key: map[string]drivers.CellInput{"id": {Text: idText}},
		}},
	})
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if del.RowsAffected != 1 {
		t.Errorf("delete affected %d rows", del.RowsAffected)
	}

	// Confirm it's gone.
	page, err = te.ReadPage(ctx, drivers.PageRequest{
		Schema: "app", Table: "users",
		Filters: []drivers.FilterSpec{{Column: "email", Op: "=", Value: email}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 0 {
		t.Errorf("row should be deleted, found %d", len(page.Rows))
	}
}

func toText(t *testing.T, v drivers.Value) string {
	t.Helper()
	switch x := v.V.(type) {
	case int64:
		return itoa64(x)
	case string:
		return x
	default:
		t.Fatalf("unexpected id value type %T", v.V)
		return ""
	}
}

func itoa64(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}

func TestExplain(t *testing.T) {
	sess := testSession(t)
	ex := sess.(drivers.Explainer)
	plan, err := ex.Explain(context.Background(), "SELECT * FROM app.users WHERE id = 42")
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	if plan.Label == "" {
		t.Error("plan root has no label")
	}
	// An indexed lookup on the PK should mention a scan node with detail.
	if plan.Detail == "" && len(plan.Children) == 0 {
		t.Errorf("expected plan detail or children, got %+v", plan)
	}
	t.Logf("plan: %s %s", plan.Label, plan.Detail)
}

func TestManualTransactionRollback(t *testing.T) {
	sess := testSession(t)
	tx := sess.(drivers.TransactionController)
	te := sess.(drivers.TableEditor)
	ctx := context.Background()
	const id = "test-console-rollback"
	const email = "manual-tx-rollback@example.com"

	if err := tx.BeginTransaction(ctx, id); err != nil {
		t.Fatal(err)
	}
	summary, err := sess.Execute(ctx, drivers.QueryRequest{
		QueryID: "tx-insert", TransactionID: id,
		Statement: "INSERT INTO app.users (email, active, score) VALUES ('" + email + "', true, 1)",
	}, func(drivers.RowBatch) {})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Error != "" {
		t.Fatal(summary.Error)
	}
	if err := tx.RollbackTransaction(ctx, id); err != nil {
		t.Fatal(err)
	}
	page, err := te.ReadPage(ctx, drivers.PageRequest{Schema: "app", Table: "users", Filters: []drivers.FilterSpec{{Column: "email", Op: "=", Value: email}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 0 {
		t.Fatalf("rolled-back row is visible")
	}
}
