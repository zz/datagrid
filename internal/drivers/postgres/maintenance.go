package postgres

import (
	"context"
	"errors"
	"strings"
)

func (s *session) MaintainTable(ctx context.Context, schema, table, operation string) (string, error) {
	target := dialect.QualifiedName(schema, table)
	var statement string
	switch operation {
	case "analyze":
		statement = "ANALYZE " + target
	case "vacuum":
		statement = "VACUUM (ANALYZE) " + target
	case "reindex":
		statement = "REINDEX TABLE " + target
	default:
		return "", errors.New("unsupported PostgreSQL maintenance operation")
	}
	if _, err := s.pool.Exec(ctx, statement); err != nil {
		return "", err
	}
	return strings.ToUpper(operation) + " completed for " + target, nil
}
