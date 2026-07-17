package api

import "testing"

func TestIsPageableStatement(t *testing.T) {
	for _, statement := range []string{"SELECT * FROM users", "( select 1 )", "select\n1"} {
		if !isPageableStatement(statement) {
			t.Errorf("expected %q to be pageable", statement)
		}
	}
	for _, statement := range []string{"WITH x AS (SELECT 1) SELECT * FROM x", "SHOW TABLES", "UPDATE users SET active = true"} {
		if isPageableStatement(statement) {
			t.Errorf("expected %q not to be pageable", statement)
		}
	}
}
