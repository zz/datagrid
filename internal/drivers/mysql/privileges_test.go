package mysql

import (
	"context"
	"testing"

	"datagrid/internal/drivers"
)

func TestPreviewPrivilegeChange(t *testing.T) {
	s := &session{}
	sql, err := s.ChangePrivilege(context.Background(), drivers.PrivilegeChange{Action: "revoke", Principal: "app", Host: "%", Privilege: "update", Scope: "schema", Schema: "sales"}, false)
	if err != nil {
		t.Fatal(err)
	}
	want := "REVOKE UPDATE ON `sales`.* FROM 'app'@'%';"
	if sql != want {
		t.Fatalf("got %q, want %q", sql, want)
	}
}
