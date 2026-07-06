package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"datagrid/internal/drivers"
)

// exec runs a DDL statement with no result rows.
func (s *session) exec(ctx context.Context, sql string) error {
	_, err := s.pool.Exec(ctx, sql)
	return err
}

func (s *session) CreateDatabase(ctx context.Context, name string) error {
	return s.exec(ctx, dialect.BuildCreateDatabase(name))
}

func (s *session) DropDatabase(ctx context.Context, name string) error {
	return s.exec(ctx, dialect.BuildDropDatabase(name))
}

func (s *session) CreateTable(ctx context.Context, spec drivers.TableSpec) error {
	sql, err := dialect.BuildCreateTable(spec)
	if err != nil {
		return err
	}
	return s.exec(ctx, sql)
}

func (s *session) DropTable(ctx context.Context, schema, table string) error {
	return s.exec(ctx, dialect.BuildDropTable(schema, table))
}

func (s *session) RenameTable(ctx context.Context, schema, table, newName string) error {
	return s.exec(ctx, dialect.BuildRenameTable(schema, table, newName))
}

func (s *session) AddColumn(ctx context.Context, schema, table string, col drivers.ColumnSpec) error {
	sql, err := dialect.BuildAddColumn(schema, table, col)
	if err != nil {
		return err
	}
	return s.exec(ctx, sql)
}

func (s *session) DropColumn(ctx context.Context, schema, table, column string) error {
	return s.exec(ctx, dialect.BuildDropColumn(schema, table, column))
}

func (s *session) RenameColumn(ctx context.Context, schema, table, column, newName string) error {
	return s.exec(ctx, dialect.BuildRenameColumn(schema, table, column, newName))
}

// ModifyColumn renames (if the name changed) then alters type/nullability/
// default in a single ALTER TABLE with multiple actions.
func (s *session) ModifyColumn(ctx context.Context, schema, table, oldName string, spec drivers.ColumnSpec) error {
	q := dialect.QualifiedName(schema, table)
	name := oldName
	if spec.Name != "" && spec.Name != oldName {
		if err := s.exec(ctx, fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", q, dialect.Quote(oldName), dialect.Quote(spec.Name))); err != nil {
			return err
		}
		name = spec.Name
	}
	col := dialect.Quote(name)
	actions := []string{}
	if strings.TrimSpace(spec.Type) != "" {
		actions = append(actions, fmt.Sprintf("ALTER COLUMN %s TYPE %s", col, spec.Type))
	}
	if spec.Nullable {
		actions = append(actions, fmt.Sprintf("ALTER COLUMN %s DROP NOT NULL", col))
	} else {
		actions = append(actions, fmt.Sprintf("ALTER COLUMN %s SET NOT NULL", col))
	}
	if strings.TrimSpace(spec.Default) != "" {
		actions = append(actions, fmt.Sprintf("ALTER COLUMN %s SET DEFAULT %s", col, spec.Default))
	} else {
		actions = append(actions, fmt.Sprintf("ALTER COLUMN %s DROP DEFAULT", col))
	}
	return s.exec(ctx, fmt.Sprintf("ALTER TABLE %s %s", q, strings.Join(actions, ", ")))
}

func (s *session) SetPrimaryKey(ctx context.Context, schema, table string, columns []string) error {
	q := dialect.QualifiedName(schema, table)
	// A primary key is a named constraint; find its name to drop it.
	var conname string
	err := s.pool.QueryRow(ctx,
		`SELECT conname FROM pg_constraint WHERE conrelid = format('%I.%I', $1::text, $2::text)::regclass AND contype = 'p'`,
		schema, table).Scan(&conname)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if conname != "" {
		if err := s.exec(ctx, fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s", q, dialect.Quote(conname))); err != nil {
			return err
		}
	}
	if len(columns) > 0 {
		cols := make([]string, len(columns))
		for i, c := range columns {
			cols[i] = dialect.Quote(c)
		}
		// ADD PRIMARY KEY implicitly sets NOT NULL on the key columns.
		return s.exec(ctx, fmt.Sprintf("ALTER TABLE %s ADD PRIMARY KEY (%s)", q, strings.Join(cols, ", ")))
	}
	return nil
}

func (s *session) ListIndexes(ctx context.Context, schema, table string) ([]drivers.IndexInfo, error) {
	rows, err := s.pool.Query(ctx, `
SELECT i.relname AS index_name,
       ix.indisunique,
       array_agg(a.attname ORDER BY k.ord) AS cols
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
WHERE n.nspname = $1 AND t.relname = $2
GROUP BY i.relname, ix.indisunique
ORDER BY i.relname`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []drivers.IndexInfo
	for rows.Next() {
		var idx drivers.IndexInfo
		if err := rows.Scan(&idx.Name, &idx.Unique, &idx.Columns); err != nil {
			return nil, err
		}
		out = append(out, idx)
	}
	return out, rows.Err()
}

func (s *session) CreateIndex(ctx context.Context, schema, table string, spec drivers.IndexSpec) error {
	sql, err := dialect.BuildCreateIndex(schema, table, spec)
	if err != nil {
		return err
	}
	return s.exec(ctx, sql)
}

func (s *session) DropIndex(ctx context.Context, schema, table, name string) error {
	// Postgres indexes are schema-scoped objects (the table is implied).
	return s.exec(ctx, "DROP INDEX "+dialect.QualifiedName(schema, name))
}
