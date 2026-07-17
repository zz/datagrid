package postgres

import (
	"context"
	"testing"

	"datagrid/internal/drivers"
)

func TestPreviewPrincipalRedactsPassword(t *testing.T) {
	s := &session{}
	sql, err := s.ChangePrincipal(context.Background(), drivers.PrincipalChange{Action: "create", Name: "analyst", Login: true, Password: "secret"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if sql != `CREATE ROLE "analyst" LOGIN PASSWORD '********';` {
		t.Fatalf("unexpected preview: %s", sql)
	}
}

func TestPreviewPasswordRotationRedactsPassword(t *testing.T) {
	s := &session{}
	sql, err := s.ChangePrincipal(context.Background(), drivers.PrincipalChange{Action: "password", Name: "analyst", Password: "replacement"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if sql != `ALTER ROLE "analyst" PASSWORD '********';` {
		t.Fatalf("unexpected preview: %s", sql)
	}
}
