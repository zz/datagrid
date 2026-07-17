package mysql

import "testing"

func TestMySQLAccount(t *testing.T) {
	name, host := mysqlAccount("'app'@'%'")
	if name != "app" || host != "%" {
		t.Fatalf("mysqlAccount returned %q, %q", name, host)
	}
}
