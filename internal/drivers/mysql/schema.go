package mysql

import (
	"context"

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
