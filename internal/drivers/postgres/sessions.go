package postgres

import (
	"context"
	"errors"
	"strconv"

	"datagrid/internal/drivers"
)

func (s *session) ListDatabaseSessions(ctx context.Context) ([]drivers.DatabaseSession, error) {
	rows, err := s.pool.Query(ctx, `
SELECT pid::text, COALESCE(usename, ''), COALESCE(datname, ''), COALESCE(state, ''),
       COALESCE(client_addr::text, 'local'), COALESCE(query, ''),
       GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(query_start, backend_start))) * 1000)::bigint),
       pid = pg_backend_pid()
FROM pg_catalog.pg_stat_activity
WHERE backend_type = 'client backend'
ORDER BY query_start NULLS LAST, pid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []drivers.DatabaseSession
	for rows.Next() {
		var item drivers.DatabaseSession
		if err := rows.Scan(&item.ID, &item.User, &item.Database, &item.State, &item.Client, &item.Query, &item.DurationMs, &item.Own); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *session) CancelDatabaseSession(ctx context.Context, id string) error {
	pid, err := strconv.ParseInt(id, 10, 32)
	if err != nil || pid <= 0 {
		return errors.New("invalid PostgreSQL backend id")
	}
	var cancelled bool
	if err := s.pool.QueryRow(ctx, "SELECT pg_cancel_backend($1)", pid).Scan(&cancelled); err != nil {
		return err
	}
	if !cancelled {
		return errors.New("backend is no longer running a query or cannot be cancelled")
	}
	return nil
}
