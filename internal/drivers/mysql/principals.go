package mysql

import (
	"context"
	"errors"
	"strings"

	"datagrid/internal/drivers"
)

func mysqlLiteral(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
func mysqlPrincipal(name, host string) string {
	if host == "" {
		host = "%"
	}
	return mysqlLiteral(name) + "@" + mysqlLiteral(host)
}

func (s *session) ChangePrincipal(ctx context.Context, change drivers.PrincipalChange, apply bool) (string, error) {
	if change.Name == "" {
		return "", errors.New("account name is required")
	}
	var statement, preview string
	switch change.Action {
	case "create":
		statement = "CREATE USER " + mysqlPrincipal(change.Name, change.Host)
		preview = statement
		if change.Password != "" {
			statement += " IDENTIFIED BY " + mysqlLiteral(change.Password)
			preview += " IDENTIFIED BY '********'"
		}
		statement += ";"
		preview += ";"
	case "password":
		if change.Password == "" {
			return "", errors.New("new password is required")
		}
		statement = "ALTER USER " + mysqlPrincipal(change.Name, change.Host) + " IDENTIFIED BY " + mysqlLiteral(change.Password) + ";"
		preview = "ALTER USER " + mysqlPrincipal(change.Name, change.Host) + " IDENTIFIED BY '********';"
	case "drop":
		if apply {
			var current string
			if err := s.db.QueryRowContext(ctx, "SELECT CURRENT_USER()").Scan(&current); err != nil {
				return "", err
			}
			currentName, currentHost := mysqlAccount(current)
			host := change.Host
			if host == "" {
				host = "%"
			}
			if currentName == change.Name && currentHost == host {
				return "", errors.New("cannot drop the currently connected account")
			}
		}
		statement = "DROP USER " + mysqlPrincipal(change.Name, change.Host) + ";"
		preview = statement
	case "grant_role", "revoke_role":
		if change.Role == "" {
			return "", errors.New("role name is required")
		}
		action := map[string]string{"grant_role": "GRANT", "revoke_role": "REVOKE"}[change.Action]
		connector := map[string]string{"grant_role": " TO ", "revoke_role": " FROM "}[change.Action]
		statement = action + " " + mysqlPrincipal(change.Role, change.RoleHost) + connector + mysqlPrincipal(change.Name, change.Host) + ";"
		preview = statement
	default:
		return "", errors.New("unsupported principal operation")
	}
	if apply {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return preview, err
		}
	}
	return preview, nil
}
