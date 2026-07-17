package drivers

import (
	"reflect"
	"testing"
)

func TestCompileNamedParameters(t *testing.T) {
	sql, args, err := CompileNamedParameters(
		"SELECT :id, :id, ':skip', value::text, $$:body$$ -- :comment\nWHERE name = :name /* :block */",
		EnginePostgres,
		map[string]string{"id": "42", "name": "Ada"},
	)
	if err != nil {
		t.Fatal(err)
	}
	wantSQL := "SELECT $1, $2, ':skip', value::text, $$:body$$ -- :comment\nWHERE name = $3 /* :block */"
	if sql != wantSQL {
		t.Fatalf("sql:\n got %s\nwant %s", sql, wantSQL)
	}
	if !reflect.DeepEqual(args, []any{"42", "42", "Ada"}) {
		t.Fatalf("args: %#v", args)
	}
}

func TestCompileNamedParametersMySQL(t *testing.T) {
	sql, args, err := CompileNamedParameters("SELECT * FROM users WHERE id = :id", EngineMySQL, map[string]string{"id": "7"})
	if err != nil {
		t.Fatal(err)
	}
	if sql != "SELECT * FROM users WHERE id = ?" || !reflect.DeepEqual(args, []any{"7"}) {
		t.Fatalf("got %q %#v", sql, args)
	}
}

func TestCompileNamedParametersMissing(t *testing.T) {
	if _, _, err := CompileNamedParameters("SELECT :missing", EnginePostgres, nil); err == nil {
		t.Fatal("expected missing parameter error")
	}
}

func TestSplitSQLStatements(t *testing.T) {
	got := SplitSQLStatements("SELECT ';'; SELECT $$a;b$$; -- ;\n SELECT 3;", EnginePostgres)
	want := []string{"SELECT ';'", "SELECT $$a;b$$", "-- ;\n SELECT 3"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestSplitSQLStatementsMySQLComment(t *testing.T) {
	got := SplitSQLStatements("SELECT 1; # ignored ;\nSELECT 2", EngineMySQL)
	want := []string{"SELECT 1", "# ignored ;\nSELECT 2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}
