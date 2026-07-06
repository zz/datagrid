package drivers

import "testing"

// myLike is a MySQL-style dialect (backtick quoting) for the shared builders.
var myLike = Dialect{
	Quote: func(s string) string { return "`" + s + "`" },
	Param: func(n int) string { return "?" },
}

func TestBuildCreateTable(t *testing.T) {
	spec := TableSpec{
		Schema: "app",
		Name:   "users",
		Columns: []ColumnSpec{
			{Name: "id", Type: "bigserial", PrimaryKey: true},
			{Name: "email", Type: "varchar(255)"},
			{Name: "status", Type: "text", Nullable: true, Default: "'active'"},
		},
	}
	sql, err := pgLike.BuildCreateTable(spec)
	if err != nil {
		t.Fatal(err)
	}
	want := `CREATE TABLE "app"."users" ("id" bigserial NOT NULL, "email" varchar(255) NOT NULL, "status" text DEFAULT 'active', PRIMARY KEY ("id"))`
	if sql != want {
		t.Errorf("create table:\n got %s\nwant %s", sql, want)
	}
}

func TestBuildCreateTableNoSchemaNoPK(t *testing.T) {
	spec := TableSpec{
		Name:    "notes",
		Columns: []ColumnSpec{{Name: "body", Type: "text", Nullable: true}},
	}
	sql, err := myLike.BuildCreateTable(spec)
	if err != nil {
		t.Fatal(err)
	}
	want := "CREATE TABLE `notes` (`body` text)"
	if sql != want {
		t.Errorf("got %s want %s", sql, want)
	}
}

func TestBuildCreateTableErrors(t *testing.T) {
	if _, err := pgLike.BuildCreateTable(TableSpec{Name: "", Columns: []ColumnSpec{{Name: "a", Type: "int"}}}); err == nil {
		t.Error("expected error for empty table name")
	}
	if _, err := pgLike.BuildCreateTable(TableSpec{Name: "t"}); err == nil {
		t.Error("expected error for no columns")
	}
	if _, err := pgLike.BuildCreateTable(TableSpec{Name: "t", Columns: []ColumnSpec{{Name: "a"}}}); err == nil {
		t.Error("expected error for column without a type")
	}
}

func TestBuildAlterStatements(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"drop table", pgLike.BuildDropTable("app", "users"), `DROP TABLE "app"."users"`},
		{"rename table", pgLike.BuildRenameTable("app", "users", "members"), `ALTER TABLE "app"."users" RENAME TO "members"`},
		{"drop column", pgLike.BuildDropColumn("app", "users", "email"), `ALTER TABLE "app"."users" DROP COLUMN "email"`},
		{"rename column", pgLike.BuildRenameColumn("app", "users", "email", "mail"), `ALTER TABLE "app"."users" RENAME COLUMN "email" TO "mail"`},
		{"create database", myLike.BuildCreateDatabase("shop"), "CREATE DATABASE `shop`"},
		{"drop database", myLike.BuildDropDatabase("shop"), "DROP DATABASE `shop`"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s:\n got %s\nwant %s", c.name, c.got, c.want)
		}
	}
}

func TestBuildCreateIndex(t *testing.T) {
	sql, err := pgLike.BuildCreateIndex("app", "users", IndexSpec{Name: "idx_users_email", Columns: []string{"email"}, Unique: true})
	if err != nil {
		t.Fatal(err)
	}
	want := `CREATE UNIQUE INDEX "idx_users_email" ON "app"."users" ("email")`
	if sql != want {
		t.Errorf("got %s want %s", sql, want)
	}

	sql, err = myLike.BuildCreateIndex("", "users", IndexSpec{Name: "idx_ab", Columns: []string{"a", "b"}})
	if err != nil {
		t.Fatal(err)
	}
	if want := "CREATE INDEX `idx_ab` ON `users` (`a`, `b`)"; sql != want {
		t.Errorf("got %s want %s", sql, want)
	}

	if _, err := pgLike.BuildCreateIndex("app", "users", IndexSpec{Name: "x"}); err == nil {
		t.Error("expected error for index with no columns")
	}
	if _, err := pgLike.BuildCreateIndex("app", "users", IndexSpec{Columns: []string{"a"}}); err == nil {
		t.Error("expected error for index with no name")
	}
}

func TestBuildAddColumn(t *testing.T) {
	sql, err := myLike.BuildAddColumn("", "users", ColumnSpec{Name: "age", Type: "int", Nullable: true})
	if err != nil {
		t.Fatal(err)
	}
	want := "ALTER TABLE `users` ADD COLUMN `age` int"
	if sql != want {
		t.Errorf("got %s want %s", sql, want)
	}
	if _, err := myLike.BuildAddColumn("", "users", ColumnSpec{Name: "x"}); err == nil {
		t.Error("expected error for column without a type")
	}
}
