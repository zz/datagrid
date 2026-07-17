package postgres

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
	allowed := map[string]bool{"SELECT": true, "INSERT": true, "UPDATE": true, "DELETE": true, "TRUNCATE": true, "REFERENCES": true, "TRIGGER": true, "USAGE": true, "CREATE": true}
	if !allowed[privilege] {
		return "", errors.New("unsupported PostgreSQL privilege")
	}
	var target string
	switch change.Scope {
	case "schema":
		if privilege != "USAGE" && privilege != "CREATE" {
			return "", errors.New("schema scope supports USAGE or CREATE")
		}
		if change.Schema == "" {
			return "", errors.New("schema is required")
		}
		target = "SCHEMA " + dialect.Quote(change.Schema)
	case "table":
		if privilege == "USAGE" || privilege == "CREATE" {
			return "", errors.New("privilege is not valid for table scope")
		}
		if change.Schema == "" || change.Object == "" {
			return "", errors.New("schema and table are required")
		}
		target = "TABLE " + dialect.QualifiedName(change.Schema, change.Object)
	default:
		return "", errors.New("PostgreSQL privilege scope must be schema or table")
	}
	if change.Principal == "" {
		return "", errors.New("principal is required")
	}
	connector := map[string]string{"GRANT": " TO ", "REVOKE": " FROM "}[action]
	statement := fmt.Sprintf("%s %s ON %s%s%s;", action, privilege, target, connector, dialect.Quote(change.Principal))
	if apply {
		_, err := s.pool.Exec(ctx, statement)
		if err != nil {
			return statement, err
		}
	}
	return statement, nil
}
