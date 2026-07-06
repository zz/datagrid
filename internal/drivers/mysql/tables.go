package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"datagrid/internal/drivers"
)

// dialect quotes MySQL identifiers with backticks and uses ? placeholders.
var dialect = drivers.Dialect{
	Quote: func(s string) string {
		return "`" + strings.ReplaceAll(s, "`", "``") + "`"
	},
	Param: func(int) string { return "?" },
}

func (s *session) TableInfo(ctx context.Context, schema, table string) (*drivers.TableInfo, error) {
	info := &drivers.TableInfo{Schema: schema, Table: table}

	rows, err := s.db.QueryContext(ctx, `
SELECT column_name, column_type, is_nullable, COALESCE(column_default, '')
FROM information_schema.columns
WHERE table_schema = ? AND table_name = ?
ORDER BY ordinal_position`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var name, typ, nullable, def string
		if err := rows.Scan(&name, &typ, &nullable, &def); err != nil {
			return nil, err
		}
		info.Columns = append(info.Columns, drivers.ColumnInfo{
			Name: name, TypeName: typ, Nullable: nullable == "YES", Default: def,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	pk, err := s.keyColumns(ctx, schema, table)
	if err != nil {
		return nil, err
	}
	info.PrimaryKey = pk
	return info, nil
}

// keyColumns returns the PRIMARY KEY columns in order, or the columns of the
// first UNIQUE index if there is no PK (so uniquely-keyed tables still edit).
func (s *session) keyColumns(ctx context.Context, schema, table string) ([]string, error) {
	pk, err := s.indexColumns(ctx, schema, table, "PRIMARY")
	if err != nil || len(pk) > 0 {
		return pk, err
	}
	// Find the name of the first non-primary unique index, then its columns.
	var idxName string
	err = s.db.QueryRowContext(ctx, `
SELECT index_name FROM information_schema.statistics
WHERE table_schema = ? AND table_name = ? AND non_unique = 0 AND index_name <> 'PRIMARY'
ORDER BY index_name LIMIT 1`, schema, table).Scan(&idxName)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.indexColumns(ctx, schema, table, idxName)
}

func (s *session) indexColumns(ctx context.Context, schema, table, index string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT column_name FROM information_schema.statistics
WHERE table_schema = ? AND table_name = ? AND index_name = ?
ORDER BY seq_in_index`, schema, table, index)
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
	limit := req.Limit
	if limit <= 0 {
		limit = 200
	}
	req.Limit = limit + 1 // one extra row signals HasMore

	sqlText, args, err := dialect.BuildSelectPage(req)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, err
	}
	page := &drivers.Page{}
	for _, ct := range colTypes {
		page.Columns = append(page.Columns, drivers.Column{Name: ct.Name(), TypeName: strings.ToLower(ct.DatabaseTypeName())})
	}

	enc := encoder{cells: s.cells, queryID: drivers.QueryID("page:" + req.Schema + "." + req.Table), types: colTypes}
	raw := make([]any, len(colTypes))
	ptrs := make([]any, len(colTypes))
	for i := range raw {
		ptrs[i] = &raw[i]
	}
	for rows.Next() {
		if len(page.Rows) == limit {
			page.HasMore = true
			break
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make([]any, len(raw))
		for i, v := range raw {
			row[i] = enc.encode(i, v)
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

func (s *session) CountRows(ctx context.Context, req drivers.PageRequest) (int64, error) {
	sqlText, args, err := dialect.BuildCount(req)
	if err != nil {
		return 0, err
	}
	var n int64
	if err := s.db.QueryRowContext(ctx, sqlText, args...).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	result := &drivers.ChangesetResult{}
	for _, st := range stmts {
		res, err := tx.ExecContext(ctx, st.SQL, st.Args...)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", st.Preview, err)
		}
		if n, err := res.RowsAffected(); err == nil {
			result.RowsAffected += n
		}
		result.Previews = append(result.Previews, st.Preview)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	return result, nil
}
