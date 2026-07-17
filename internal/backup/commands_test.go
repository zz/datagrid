package backup

import (
	"slices"
	"testing"

	"datagrid/internal/drivers"
)

func config(engine string) drivers.ConnectionConfig {
	return drivers.ConnectionConfig{Engine: drivers.Engine(engine), Host: "db.internal", Port: 5432, User: "app", Database: "inventory"}
}

func TestPostgresDumpUsesCustomFormatAndPasswordEnvironment(t *testing.T) {
	cmd, err := Dump(config("postgres"), "secret", "/tmp/inventory.dump", "custom")
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Tool != "pg_dump" || !slices.Contains(cmd.Args, "custom") {
		t.Fatalf("unexpected command: %#v", cmd)
	}
	if !slices.Contains(cmd.Env, "PGPASSWORD=secret") {
		t.Fatalf("password environment missing: %#v", cmd.Env)
	}
}

func TestRestoreSelectsPostgresToolFromExtension(t *testing.T) {
	custom, _ := Restore(config("postgres"), "", "/tmp/db.backup", true)
	plain, _ := Restore(config("postgres"), "", "/tmp/db.sql", false)
	if custom.Tool != "pg_restore" || !slices.Contains(custom.Args, "--clean") {
		t.Fatalf("unexpected custom restore: %#v", custom)
	}
	if plain.Tool != "psql" || !slices.Contains(plain.Args, "ON_ERROR_STOP=on") {
		t.Fatalf("unexpected plain restore: %#v", plain)
	}
}

func TestMySQLCommandsAvoidShellExecution(t *testing.T) {
	dump, _ := Dump(config("mysql"), "pw", "/tmp/db.sql", "plain")
	restore, _ := Restore(config("mysql"), "pw", "/tmp/db.sql", false)
	if dump.Tool != "mysqldump" || !slices.Contains(dump.Args, "--result-file") {
		t.Fatalf("unexpected dump: %#v", dump)
	}
	if restore.Tool != "mysql" || restore.StdinPath != "/tmp/db.sql" {
		t.Fatalf("unexpected restore: %#v", restore)
	}
}
