package mysql

import (
	"context"
	"errors"
	"fmt"
)

func (s *session) MaintainTable(ctx context.Context, schema, table, operation string) (string, error) {
	var command string
	switch operation {
	case "analyze":
		command = "ANALYZE TABLE "
	case "check":
		command = "CHECK TABLE "
	case "optimize":
		command = "OPTIMIZE TABLE "
	default:
		return "", errors.New("unsupported MySQL maintenance operation")
	}
	rows, err := s.db.QueryContext(ctx, command+dialect.QualifiedName(schema, table))
	if err != nil {
		return "", err
	}
	defer rows.Close()
	message := "Operation completed"
	for rows.Next() {
		var tableName, op, messageType, text string
		if err := rows.Scan(&tableName, &op, &messageType, &text); err != nil {
			return "", err
		}
		message = fmt.Sprintf("%s: %s", messageType, text)
	}
	return message, rows.Err()
}
