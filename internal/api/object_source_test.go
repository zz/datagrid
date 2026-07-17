package api

import (
	"strings"
	"testing"
)

func TestMySQLViewSourceUsesReplace(t *testing.T) {
	statements, err := mysqlObjectStatements("view", "app", "active", "CREATE ALGORITHM=UNDEFINED VIEW `app`.`active` AS SELECT 1;")
	if err != nil {
		t.Fatal(err)
	}
	if len(statements) != 1 || !strings.HasPrefix(statements[0], "CREATE OR REPLACE ALGORITHM") {
		t.Fatalf("unexpected statements: %#v", statements)
	}
}

func TestMySQLRoutineSourcePreservesBody(t *testing.T) {
	source := "CREATE DEFINER=`root`@`%` PROCEDURE `app`.`refresh`() BEGIN SELECT 1; SELECT 2; END;"
	statements, err := mysqlObjectStatements("routine", "app", "refresh", source)
	if err != nil {
		t.Fatal(err)
	}
	if statements[0] != "DROP PROCEDURE IF EXISTS `app`.`refresh`" || statements[1] != source {
		t.Fatalf("unexpected statements: %#v", statements)
	}
}

func TestMySQLRoutineSourceRequiresRoutineType(t *testing.T) {
	if _, err := mysqlObjectStatements("routine", "app", "bad", "SELECT 1"); err == nil {
		t.Fatal("expected invalid source error")
	}
}

func TestPostgresTriggerSourcePlansTransactionalReplacement(t *testing.T) {
	script, err := postgresObjectScript("trigger", `touch_rows`, `CREATE TRIGGER touch_rows BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.touch();`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(script, `DROP TRIGGER "touch_rows" ON public.accounts;`) {
		t.Fatalf("unexpected script: %s", script)
	}
}

func TestSequenceSourceBecomesAlter(t *testing.T) {
	postgres, err := postgresObjectScript("sequence", "orders_id_seq", "CREATE SEQUENCE public.orders_id_seq INCREMENT BY 2;")
	if err != nil || !strings.HasPrefix(postgres, "ALTER SEQUENCE") {
		t.Fatalf("unexpected PostgreSQL sequence: %q, %v", postgres, err)
	}
	mysql, err := mysqlObjectStatements("sequence", "app", "orders_id_seq", "CREATE SEQUENCE `app`.`orders_id_seq` START WITH 2;")
	if err != nil || !strings.HasPrefix(mysql[0], "ALTER SEQUENCE") {
		t.Fatalf("unexpected MySQL sequence: %#v, %v", mysql, err)
	}
}

func TestMySQLTriggerSourcePlansDropCreate(t *testing.T) {
	source := "CREATE TRIGGER `app`.`touch` BEFORE UPDATE ON `app`.`items` FOR EACH ROW SET NEW.updated_at=NOW();"
	statements, err := mysqlObjectStatements("trigger", "app", "touch", source)
	if err != nil {
		t.Fatal(err)
	}
	if statements[0] != "DROP TRIGGER IF EXISTS `app`.`touch`" || statements[1] != source {
		t.Fatalf("unexpected statements: %#v", statements)
	}
}

func TestObjectDropStatementsUseServerSourceDetails(t *testing.T) {
	trigger, err := objectDropStatement("postgres", "trigger", "public", "touch", "CREATE TRIGGER touch BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.touch()")
	if err != nil || trigger != `DROP TRIGGER "touch" ON public.items` {
		t.Fatalf("unexpected trigger drop: %q, %v", trigger, err)
	}
	routine, err := objectDropStatement("postgres", "routine", "public", "calculate", "CREATE OR REPLACE FUNCTION public.calculate(value integer DEFAULT 1, scale numeric(8,2) = 2.5) RETURNS numeric")
	if err != nil || routine != "DROP FUNCTION public.calculate(value integer, scale numeric(8,2))" {
		t.Fatalf("unexpected routine drop: %q, %v", routine, err)
	}
	materialized, _ := objectDropStatement("postgres", "view", "reporting", "summary", "CREATE MATERIALIZED VIEW reporting.summary AS SELECT 1")
	if materialized != `DROP MATERIALIZED VIEW "reporting"."summary"` {
		t.Fatalf("unexpected view drop: %q", materialized)
	}
}

func TestObjectRenameSupportMatrix(t *testing.T) {
	view, err := objectRenameStatement("mysql", "view", "app", "old", "new", "CREATE VIEW app.old AS SELECT 1")
	if err != nil || view != "RENAME TABLE `app`.`old` TO `app`.`new`" {
		t.Fatalf("unexpected view rename: %q, %v", view, err)
	}
	sequence, err := objectRenameStatement("postgres", "sequence", "public", "old_seq", "new_seq", "CREATE SEQUENCE public.old_seq")
	if err != nil || sequence != `ALTER SEQUENCE "public"."old_seq" RENAME TO "new_seq"` {
		t.Fatalf("unexpected sequence rename: %q, %v", sequence, err)
	}
	if _, err := objectRenameStatement("mysql", "routine", "app", "old", "new", ""); err == nil {
		t.Fatal("expected unsupported routine rename")
	}
}
