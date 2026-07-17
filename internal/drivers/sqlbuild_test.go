package drivers

import "testing"

// pgLike is a Postgres-style dialect for exercising the shared builders
// without a live database.
var pgLike = Dialect{
	Quote:         func(s string) string { return `"` + s + `"` },
	Param:         func(n int) string { return "$" + itoa(n) },
	DefaultValues: "DEFAULT VALUES",
}

func itoa(n int) string {
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

func TestBuildSelectPage(t *testing.T) {
	sql, args, err := pgLike.BuildSelectPage(PageRequest{
		Schema:  "app",
		Table:   "users",
		Filters: []FilterSpec{{Column: "email", Op: "contains", Value: "bob"}},
		Sorts:   []SortSpec{{Column: "id", Desc: true}},
		Limit:   50,
		Offset:  100,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `SELECT * FROM "app"."users" WHERE "email" LIKE $1 ORDER BY "id" DESC LIMIT $2 OFFSET $3`
	if sql != want {
		t.Errorf("sql:\n got %s\nwant %s", sql, want)
	}
	if len(args) != 3 || args[0] != "%bob%" || args[1] != 50 || args[2] != 100 {
		t.Errorf("args = %v", args)
	}
}

func TestBuildSelectPageRawWhere(t *testing.T) {
	sql, args, err := pgLike.BuildSelectPage(PageRequest{
		Schema:   "app",
		Table:    "users",
		WhereRaw: "id > 100 AND active",
		Filters:  []FilterSpec{{Column: "email", Op: "contains", Value: "bob"}},
		Limit:    50,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Raw expression is parenthesized and ANDed before structured filters;
	// structured params still start at $1.
	want := `SELECT * FROM "app"."users" WHERE (id > 100 AND active) AND "email" LIKE $1 LIMIT $2`
	if sql != want {
		t.Errorf("sql:\n got %s\nwant %s", sql, want)
	}
	if len(args) != 2 || args[0] != "%bob%" || args[1] != 50 {
		t.Errorf("args = %v", args)
	}
}

func TestBuildCount(t *testing.T) {
	sql, args, err := pgLike.BuildCount(PageRequest{
		Schema:   "app",
		Table:    "users",
		WhereRaw: "id > 100",
	})
	if err != nil {
		t.Fatal(err)
	}
	if sql != `SELECT COUNT(*) FROM "app"."users" WHERE (id > 100)` {
		t.Errorf("count sql: %s", sql)
	}
	if len(args) != 0 {
		t.Errorf("args = %v", args)
	}
}

func TestBuildSelectPageRejectsBadOp(t *testing.T) {
	_, _, err := pgLike.BuildSelectPage(PageRequest{
		Table:   "t",
		Filters: []FilterSpec{{Column: "c", Op: "; DROP", Value: "x"}},
	})
	if err == nil {
		t.Fatal("expected error for unknown filter op")
	}
}

func TestBuildChangesetUpdate(t *testing.T) {
	stmts, err := pgLike.BuildChangeset(ChangesetRequest{
		Schema: "app",
		Table:  "users",
		Changes: []RowChange{{
			Kind: "update",
			Set:  map[string]CellInput{"email": {Text: "new@x.com"}, "active": {Null: true}},
			Key:  map[string]CellInput{"id": {Text: "7"}},
		}},
	}, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	if len(stmts) != 1 {
		t.Fatalf("want 1 statement, got %d", len(stmts))
	}
	// Set columns are sorted: active, email → $1, $2; PK id → $3.
	wantSQL := `UPDATE "app"."users" SET "active" = $1, "email" = $2 WHERE "id" = $3`
	if stmts[0].SQL != wantSQL {
		t.Errorf("sql:\n got %s\nwant %s", stmts[0].SQL, wantSQL)
	}
	if len(stmts[0].Args) != 3 || stmts[0].Args[0] != nil || stmts[0].Args[1] != "new@x.com" || stmts[0].Args[2] != "7" {
		t.Errorf("args = %v", stmts[0].Args)
	}
	wantPrev := `UPDATE "app"."users" SET "active" = NULL, "email" = 'new@x.com' WHERE "id" = '7'`
	if stmts[0].Preview != wantPrev {
		t.Errorf("preview:\n got %s\nwant %s", stmts[0].Preview, wantPrev)
	}
}

func TestBuildChangesetUsesOriginalValuesForOptimisticLocking(t *testing.T) {
	req := ChangesetRequest{
		Table: "users",
		Changes: []RowChange{{
			Kind: "update",
			Set:  map[string]CellInput{"name": {Text: "Grace"}},
			Key:  map[string]CellInput{"id": {Text: "7"}},
			Original: map[string]CellInput{
				"id":    {Text: "7"},
				"name":  {Text: "Ada"},
				"email": {Null: true},
			},
		}},
	}
	stmts, err := pgLike.BuildChangeset(req, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	want := `UPDATE "users" SET "name" = $1 WHERE "id" = $2 AND "email" IS NULL AND "name" = $3`
	if stmts[0].SQL != want {
		t.Fatalf("sql:\n got %s\nwant %s", stmts[0].SQL, want)
	}
	if got := stmts[0].Args; len(got) != 3 || got[0] != "Grace" || got[1] != "7" || got[2] != "Ada" {
		t.Fatalf("args = %v", got)
	}
	if stmts[0].ChangeIndex != 0 || stmts[0].Kind != "update" || stmts[0].Key["id"].Text != "7" {
		t.Fatalf("statement metadata = %+v", stmts[0])
	}

	req.Force = true
	forced, err := pgLike.BuildChangeset(req, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	if want := `UPDATE "users" SET "name" = $1 WHERE "id" = $2`; forced[0].SQL != want {
		t.Fatalf("forced sql:\n got %s\nwant %s", forced[0].SQL, want)
	}
}

func TestBuildChangesetDeleteUsesOriginalValues(t *testing.T) {
	stmts, err := pgLike.BuildChangeset(ChangesetRequest{
		Table: "users",
		Changes: []RowChange{{
			Kind:     "delete",
			Key:      map[string]CellInput{"id": {Text: "9"}},
			Original: map[string]CellInput{"status": {Text: "active"}},
		}},
	}, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	want := `DELETE FROM "users" WHERE "id" = $1 AND "status" = $2`
	if stmts[0].SQL != want {
		t.Fatalf("sql:\n got %s\nwant %s", stmts[0].SQL, want)
	}
}

func TestBuildChangesetInsertDelete(t *testing.T) {
	stmts, err := pgLike.BuildChangeset(ChangesetRequest{
		Table: "t",
		Changes: []RowChange{
			{Kind: "insert", Set: map[string]CellInput{"a": {Text: "1"}, "b": {Text: "2"}}},
			{Kind: "delete", Key: map[string]CellInput{"id": {Text: "9"}}},
		},
	}, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	if stmts[0].SQL != `INSERT INTO "t" ("a", "b") VALUES ($1, $2)` {
		t.Errorf("insert sql: %s", stmts[0].SQL)
	}
	if stmts[1].SQL != `DELETE FROM "t" WHERE "id" = $1` {
		t.Errorf("delete sql: %s", stmts[1].SQL)
	}
}

func TestBuildChangesetDefaultValuesInsert(t *testing.T) {
	stmts, err := pgLike.BuildChangeset(ChangesetRequest{
		Table: "events", Changes: []RowChange{{Kind: "insert", Set: map[string]CellInput{}}},
	}, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := stmts[0].SQL, `INSERT INTO "events" DEFAULT VALUES`; got != want {
		t.Fatalf("sql:\n got %s\nwant %s", got, want)
	}
}

func TestBuildChangesetMySQLDefaultValuesInsert(t *testing.T) {
	mysqlLike := Dialect{
		Quote:         func(s string) string { return "`" + s + "`" },
		Param:         func(int) string { return "?" },
		DefaultValues: "() VALUES ()",
	}
	stmts, err := mysqlLike.BuildChangeset(ChangesetRequest{
		Table: "events", Changes: []RowChange{{Kind: "insert", Set: map[string]CellInput{}}},
	}, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := stmts[0].SQL, "INSERT INTO `events` () VALUES ()"; got != want {
		t.Fatalf("sql:\n got %s\nwant %s", got, want)
	}
}

func TestBuildChangesetNoPKFails(t *testing.T) {
	_, err := pgLike.BuildChangeset(ChangesetRequest{
		Table:   "t",
		Changes: []RowChange{{Kind: "delete", Key: map[string]CellInput{"id": {Text: "1"}}}},
	}, nil)
	if err == nil {
		t.Fatal("expected error deleting without a primary key")
	}
}
