package postgres

import (
	"context"
	"errors"
	"strings"

	"datagrid/internal/drivers"
)

func pgLiteral(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }

func (s *session) ChangePrincipal(ctx context.Context, change drivers.PrincipalChange, apply bool) (string, error) {
	if change.Name == "" {
		return "", errors.New("principal name is required")
	}
	var statement, preview string
	switch change.Action {
	case "create":
		statement = "CREATE ROLE " + dialect.Quote(change.Name) + map[bool]string{true: " LOGIN", false: " NOLOGIN"}[change.Login]
		preview = statement
		if change.Password != "" {
			statement += " PASSWORD " + pgLiteral(change.Password)
			preview += " PASSWORD '********'"
		}
		statement += ";"
		preview += ";"
	case "password":
		if change.Password == "" {
			return "", errors.New("new password is required")
		}
		statement = "ALTER ROLE " + dialect.Quote(change.Name) + " PASSWORD " + pgLiteral(change.Password) + ";"
		preview = "ALTER ROLE " + dialect.Quote(change.Name) + " PASSWORD '********';"
	case "drop":
		if apply {
			var current string
			if err := s.pool.QueryRow(ctx, "SELECT current_user").Scan(&current); err != nil {
				return "", err
			}
			if current == change.Name {
				return "", errors.New("cannot drop the currently connected role")
			}
		}
		statement = "DROP ROLE " + dialect.Quote(change.Name) + ";"
		preview = statement
	case "grant_role", "revoke_role":
		if change.Role == "" {
			return "", errors.New("role name is required")
		}
		action := map[string]string{"grant_role": "GRANT", "revoke_role": "REVOKE"}[change.Action]
		connector := map[string]string{"grant_role": " TO ", "revoke_role": " FROM "}[change.Action]
		statement = action + " " + dialect.Quote(change.Role) + connector + dialect.Quote(change.Name) + ";"
		preview = statement
	default:
		return "", errors.New("unsupported principal operation")
	}
	if apply {
		if _, err := s.pool.Exec(ctx, statement); err != nil {
			return preview, err
		}
	}
	return preview, nil
}
