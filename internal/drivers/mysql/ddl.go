package mysql

import (
	"context"
	"fmt"
	"strings"
)

func (s *session) ObjectDDL(ctx context.Context, kind, schema, name string) (string, error) {
	qualified := dialect.QualifiedName(schema, name)
	query := ""
	switch kind {
	case "table":
		query = "SHOW CREATE TABLE " + qualified
	case "view":
		query = "SHOW CREATE VIEW " + qualified
	case "trigger":
		query = "SHOW CREATE TRIGGER " + qualified
	case "sequence":
		query = "SHOW CREATE SEQUENCE " + qualified
	case "routine":
		var routineType string
		if err := s.db.QueryRowContext(ctx, `SELECT routine_type FROM information_schema.routines WHERE routine_schema=? AND routine_name=? LIMIT 1`, schema, name).Scan(&routineType); err != nil {
			return "", err
		}
		query = "SHOW CREATE " + routineType + " " + qualified
	default:
		return "", fmt.Errorf("DDL is not supported for object kind %q", kind)
	}
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	if !rows.Next() {
		return "", fmt.Errorf("object %s was not found", qualified)
	}
	columns, err := rows.Columns()
	if err != nil {
		return "", err
	}
	values := make([]any, len(columns))
	pointers := make([]any, len(columns))
	for i := range values {
		pointers[i] = &values[i]
	}
	if err := rows.Scan(pointers...); err != nil {
		return "", err
	}
	for i, column := range columns {
		label := strings.ToLower(column)
		if !strings.Contains(label, "create") && label != "sql original statement" {
			continue
		}
		if raw, ok := values[i].([]byte); ok && len(raw) > 0 {
			return string(raw) + ";", nil
		}
		if text, ok := values[i].(string); ok && text != "" {
			return text + ";", nil
		}
	}
	return "", fmt.Errorf("server returned no DDL for %s", qualified)
}
