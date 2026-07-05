package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"datagrid/internal/drivers"
)

// dialect quotes Postgres identifiers and renders $n placeholders.
var dialect = drivers.Dialect{
	Quote: func(s string) string {
		return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	},
	Param: func(n int) string { return fmt.Sprintf("$%d", n) },
}

// typeMap renders column type names in ReadPage; a shared instance is fine.
var typeMap = pgtype.NewMap()

func (s *session) TableInfo(ctx context.Context, schema, table string) (*drivers.TableInfo, error) {
	info := &drivers.TableInfo{Schema: schema, Table: table}

	rows, err := s.pool.Query(ctx, `
SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var name, typ string
		var notnull bool
		if err := rows.Scan(&name, &typ, &notnull); err != nil {
			return nil, err
		}
		info.Columns = append(info.Columns, drivers.ColumnInfo{Name: name, TypeName: typ, Nullable: !notnull})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Primary key columns in key order; fall back to a unique constraint so
	// tables with only a UNIQUE key are still editable.
	pk, err := s.keyColumns(ctx, schema, table, "p")
	if err != nil {
		return nil, err
	}
	if len(pk) == 0 {
		if pk, err = s.keyColumns(ctx, schema, table, "u"); err != nil {
			return nil, err
		}
	}
	info.PrimaryKey = pk
	return info, nil
}

func (s *session) keyColumns(ctx context.Context, schema, table, contype string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
SELECT a.attname
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
WHERE n.nspname = $1 AND c.relname = $2 AND con.contype = $3
ORDER BY array_position(con.conkey, a.attnum)`, schema, table, contype)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return nil, err
		}
		cols = append(cols, col)
	}
	return cols, rows.Err()
}

func (s *session) ReadPage(ctx context.Context, req drivers.PageRequest) (*drivers.Page, error) {
	// Fetch one extra row to learn whether another page exists.
	limit := req.Limit
	if limit <= 0 {
		limit = 200
	}
	req.Limit = limit + 1

	sqlText, args, err := dialect.BuildSelectPage(req)
	if err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &drivers.Page{}
	for _, fd := range rows.FieldDescriptions() {
		typeName := fmt.Sprintf("oid:%d", fd.DataTypeOID)
		if t, ok := typeMap.TypeForOID(fd.DataTypeOID); ok {
			typeName = t.Name
		}
		page.Columns = append(page.Columns, drivers.Column{Name: fd.Name, TypeName: typeName})
	}

	enc := encoder{cells: s.cells, queryID: drivers.QueryID("page:" + req.Schema + "." + req.Table)}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		if len(page.Rows) == limit { // the sentinel extra row
			page.HasMore = true
			break
		}
		row := make([]any, len(vals))
		for i, v := range vals {
			row[i] = enc.encode(v)
		}
		page.Rows = append(page.Rows, row)
	}
	return page, rows.Err()
}

func (s *session) PreviewChanges(ctx context.Context, req drivers.ChangesetRequest) ([]string, error) {
	info, err := s.TableInfo(ctx, req.Schema, req.Table)
	if err != nil {
		return nil, err
	}
	stmts, err := dialect.BuildChangeset(req, info.PrimaryKey)
	if err != nil {
		return nil, err
	}
	previews := make([]string, len(stmts))
	for i, st := range stmts {
		previews[i] = st.Preview
	}
	return previews, nil
}

func (s *session) ApplyChanges(ctx context.Context, req drivers.ChangesetRequest) (*drivers.ChangesetResult, error) {
	info, err := s.TableInfo(ctx, req.Schema, req.Table)
	if err != nil {
		return nil, err
	}
	stmts, err := dialect.BuildChangeset(req, info.PrimaryKey)
	if err != nil {
		return nil, err
	}
	if len(stmts) == 0 {
		return &drivers.ChangesetResult{}, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) // no-op after commit

	result := &drivers.ChangesetResult{}
	for _, st := range stmts {
		tag, err := tx.Exec(ctx, st.SQL, st.Args...)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", st.Preview, err)
		}
		result.RowsAffected += tag.RowsAffected()
		result.Previews = append(result.Previews, st.Preview)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}
