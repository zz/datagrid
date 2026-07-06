package mysql

import (
	"context"
	"fmt"
	"strings"

	"datagrid/internal/drivers"
)

// exec runs a DDL statement with no result rows.
func (s *session) exec(ctx context.Context, sql string) error {
	_, err := s.db.ExecContext(ctx, sql)
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

// ModifyColumn uses CHANGE COLUMN, which renames and redefines the column in
// one statement. spec carries the new name/type/nullability/default.
func (s *session) ModifyColumn(ctx context.Context, schema, table, oldName string, spec drivers.ColumnSpec) error {
	def, err := dialect.ColumnDef(spec)
	if err != nil {
		return err
	}
	return s.exec(ctx, fmt.Sprintf("ALTER TABLE %s CHANGE COLUMN %s %s", dialect.QualifiedName(schema, table), dialect.Quote(oldName), def))
}

func (s *session) SetPrimaryKey(ctx context.Context, schema, table string, columns []string) error {
	var n int
	if err := s.db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = ? AND table_name = ? AND constraint_type = 'PRIMARY KEY'`, schema, table).Scan(&n); err != nil {
		return err
	}
	var actions []string
	if n > 0 {
		actions = append(actions, "DROP PRIMARY KEY")
	}
	if len(columns) > 0 {
		cols := make([]string, len(columns))
		for i, c := range columns {
			cols[i] = dialect.Quote(c)
		}
		actions = append(actions, "ADD PRIMARY KEY ("+strings.Join(cols, ", ")+")")
	}
	if len(actions) == 0 {
		return nil
	}
	return s.exec(ctx, fmt.Sprintf("ALTER TABLE %s %s", dialect.QualifiedName(schema, table), strings.Join(actions, ", ")))
}

func (s *session) ListIndexes(ctx context.Context, schema, table string) ([]drivers.IndexInfo, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT index_name,
       MAX(non_unique) = 0 AS is_unique,
       GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
FROM information_schema.statistics
WHERE table_schema = ? AND table_name = ?
GROUP BY index_name
ORDER BY index_name`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []drivers.IndexInfo
	for rows.Next() {
		var idx drivers.IndexInfo
		var cols string
		if err := rows.Scan(&idx.Name, &idx.Unique, &cols); err != nil {
			return nil, err
		}
		idx.Columns = strings.Split(cols, ",")
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
	// MySQL drops an index in the context of its table.
	return s.exec(ctx, fmt.Sprintf("DROP INDEX %s ON %s", dialect.Quote(name), dialect.QualifiedName(schema, table)))
}
