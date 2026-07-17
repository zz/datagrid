package mysql

import (
	"context"
	"testing"

	"datagrid/internal/drivers"
)

func TestPreviewRoleMembership(t *testing.T) {
	s := &session{}
	sql, err := s.ChangePrincipal(context.Background(), drivers.PrincipalChange{Action: "grant_role", Name: "app", Host: "%", Role: "reader", RoleHost: "%"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if sql != "GRANT 'reader'@'%' TO 'app'@'%';" {
		t.Fatalf("unexpected preview: %s", sql)
	}
}

func TestPreviewDropAccount(t *testing.T) {
	s := &session{}
	sql, err := s.ChangePrincipal(context.Background(), drivers.PrincipalChange{Action: "drop", Name: "old", Host: "localhost"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if sql != "DROP USER 'old'@'localhost';" {
		t.Fatalf("unexpected preview: %s", sql)
	}
}
