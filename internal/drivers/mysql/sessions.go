package mysql

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"

	"datagrid/internal/drivers"
)

func (s *session) ListDatabaseSessions(ctx context.Context) ([]drivers.DatabaseSession, error) {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	var ownID uint64
	if err := conn.QueryRowContext(ctx, "SELECT CONNECTION_ID()").Scan(&ownID); err != nil {
		return nil, err
	}
	rows, err := conn.QueryContext(ctx, `SELECT ID, USER, DB, COMMAND, TIME, STATE, INFO FROM information_schema.PROCESSLIST ORDER BY TIME DESC, ID`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []drivers.DatabaseSession
	for rows.Next() {
		var id uint64
		var user, command string
		var database, state, query sql.NullString
		var seconds int64
		if err := rows.Scan(&id, &user, &database, &command, &seconds, &state, &query); err != nil {
			return nil, err
		}
		out = append(out, drivers.DatabaseSession{ID: strconv.FormatUint(id, 10), User: user, Database: database.String,
			State: firstNonEmpty(state.String, command), Query: query.String, DurationMs: seconds * 1000, Own: id == ownID})
	}
	return out, rows.Err()
}

func (s *session) CancelDatabaseSession(ctx context.Context, id string) error {
	connectionID, err := strconv.ParseUint(id, 10, 64)
	if err != nil || connectionID == 0 {
		return errors.New("invalid MySQL connection id")
	}
	_, err = s.db.ExecContext(ctx, fmt.Sprintf("KILL QUERY %d", connectionID))
	return err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
