package mysql

import (
	"context"
	"slices"
	"testing"

	"datagrid/internal/drivers"
)

func TestTableInfoPK(t *testing.T) {
	sess := testSession(t)
	te := sess.(drivers.TableEditor)

	info, err := te.TableInfo(context.Background(), "datagrid_test", "users")
	if err != nil {
		t.Fatalf("table info: %v", err)
	}
	if !slices.Equal(info.PrimaryKey, []string{"id"}) {
		t.Errorf("primary key: want [id], got %v", info.PrimaryKey)
	}
	if len(info.Columns) < 5 {
		t.Errorf("want several columns, got %d", len(info.Columns))
	}
}

func TestReadPageSortFilterPaging(t *testing.T) {
	sess := testSession(t)
	te := sess.(drivers.TableEditor)
	ctx := context.Background()

	page, err := te.ReadPage(ctx, drivers.PageRequest{
		Schema: "datagrid_test", Table: "users",
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
	if page.Rows[0][0].(drivers.Value).V != int64(25000) {
		t.Errorf("first id desc: want 25000, got %v", page.Rows[0][0].(drivers.Value).V)
	}

	page, err = te.ReadPage(ctx, drivers.PageRequest{
		Schema: "datagrid_test", Table: "users",
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

func TestApplyChangesRoundTrip(t *testing.T) {
	sess := testSession(t)
	te := sess.(drivers.TableEditor)
	ctx := context.Background()

	const email = "m3-mysql-roundtrip@example.com"

	ins, err := te.ApplyChanges(ctx, drivers.ChangesetRequest{
		Schema: "datagrid_test", Table: "users",
		Changes: []drivers.RowChange{{Kind: "insert", Set: map[string]drivers.CellInput{
			"email": {Text: email}, "active": {Text: "1"}, "score": {Text: "1.5"},
		}}},
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if ins.RowsAffected != 1 {
		t.Errorf("insert affected %d rows", ins.RowsAffected)
	}

	page, err := te.ReadPage(ctx, drivers.PageRequest{
		Schema: "datagrid_test", Table: "users",
		Filters: []drivers.FilterSpec{{Column: "email", Op: "=", Value: email}},
	})
	if err != nil || len(page.Rows) != 1 {
		t.Fatalf("lookup inserted row: %v (rows=%d)", err, len(page.Rows))
	}
	id := page.Rows[0][0].(drivers.Value) // id is first column
	idText := itoa64(id.V.(int64))

	upd, err := te.ApplyChanges(ctx, drivers.ChangesetRequest{
		Schema: "datagrid_test", Table: "users",
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

	del, err := te.ApplyChanges(ctx, drivers.ChangesetRequest{
		Schema: "datagrid_test", Table: "users",
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

	page, err = te.ReadPage(ctx, drivers.PageRequest{
		Schema: "datagrid_test", Table: "users",
		Filters: []drivers.FilterSpec{{Column: "email", Op: "=", Value: email}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 0 {
		t.Errorf("row should be deleted, found %d", len(page.Rows))
	}
}

func itoa64(n int64) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
