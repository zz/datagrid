package postgres

import (
	"context"
	"testing"

	"datagrid/internal/drivers"
)

func TestPreviewPrivilegeChange(t *testing.T) {
	s := &session{}
	sql, err := s.ChangePrivilege(context.Background(), drivers.PrivilegeChange{Action: "grant", Principal: `report"role`, Privilege: "select", Scope: "table", Schema: "public", Object: "orders"}, false)
	if err != nil {
		t.Fatal(err)
	}
	want := `GRANT SELECT ON TABLE "public"."orders" TO "report""role";`
	if sql != want {
		t.Fatalf("got %q, want %q", sql, want)
	}
}
