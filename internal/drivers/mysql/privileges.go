package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"datagrid/internal/drivers"
)

func (s *session) ChangePrivilege(ctx context.Context, change drivers.PrivilegeChange, apply bool) (string, error) {
	action := strings.ToUpper(change.Action)
	if action != "GRANT" && action != "REVOKE" {
		return "", errors.New("action must be grant or revoke")
	}
	privilege := strings.ToUpper(change.Privilege)
	allowed := map[string]bool{"SELECT": true, "INSERT": true, "UPDATE": true, "DELETE": true, "CREATE": true, "DROP": true, "ALTER": true, "INDEX": true, "REFERENCES": true, "EXECUTE": true}
	if !allowed[privilege] {
		return "", errors.New("unsupported MySQL privilege")
	}
	var target string
	switch change.Scope {
	case "global":
		target = "*.*"
	case "schema":
		if change.Schema == "" {
			return "", errors.New("schema is required")
		}
		target = dialect.Quote(change.Schema) + ".*"
	case "table":
		if change.Schema == "" || change.Object == "" {
			return "", errors.New("schema and table are required")
		}
		target = dialect.QualifiedName(change.Schema, change.Object)
	default:
		return "", errors.New("invalid MySQL privilege scope")
	}
	if change.Principal == "" {
		return "", errors.New("principal is required")
	}
	host := change.Host
	if host == "" {
		host = "%"
	}
	account := "'" + strings.ReplaceAll(change.Principal, "'", "''") + "'@'" + strings.ReplaceAll(host, "'", "''") + "'"
	connector := map[string]string{"GRANT": " TO ", "REVOKE": " FROM "}[action]
	statement := fmt.Sprintf("%s %s ON %s%s%s;", action, privilege, target, connector, account)
	if apply {
		_, err := s.db.ExecContext(ctx, statement)
		if err != nil {
			return statement, err
		}
	}
	return statement, nil
}
