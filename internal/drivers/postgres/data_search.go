package postgres

import (
	"context"
	"fmt"

	"datagrid/internal/drivers"
)

type searchableColumn struct{ schema, table, column string }

func (s *session) SearchData(ctx context.Context, request drivers.DataSearchRequest) (*drivers.DataSearchResult, error) {
	if request.MaxTables <= 0 || request.MaxTables > 100 {
		request.MaxTables = 50
	}
	if request.MaxResults <= 0 || request.MaxResults > 500 {
		request.MaxResults = 200
	}
	rows, err := s.pool.Query(ctx, `
SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE table_schema <> 'information_schema' AND table_schema NOT LIKE 'pg_%'
  AND (data_type IN ('character varying','character','text','json','jsonb','uuid','xml') OR udt_name IN ('citext'))
ORDER BY table_schema, table_name, ordinal_position`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var columns []searchableColumn
	for rows.Next() {
		var col searchableColumn
		if err := rows.Scan(&col.schema, &col.table, &col.column); err != nil {
			return nil, err
		}
		columns = append(columns, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := &drivers.DataSearchResult{}
	seenTables := map[string]bool{}
	for _, col := range columns {
		key := col.schema + "\x00" + col.table
		if !seenTables[key] {
			if len(seenTables) >= request.MaxTables {
				result.Limited = true
				break
			}
			seenTables[key] = true
			result.TablesScanned++
		}
		remaining := request.MaxResults - len(result.Matches)
		if remaining <= 0 {
			result.Limited = true
			break
		}
		limit := remaining
		if limit > 10 {
			limit = 10
		}
		query := fmt.Sprintf("SELECT left(CAST(%s AS text), 500) FROM %s WHERE strpos(lower(CAST(%s AS text)), lower($1)) > 0 LIMIT %d", dialect.Quote(col.column), dialect.QualifiedName(col.schema, col.table), dialect.Quote(col.column), limit)
		found, queryErr := s.pool.Query(ctx, query, request.Query)
		if queryErr != nil {
			continue
		}
		for found.Next() {
			var value string
			if found.Scan(&value) == nil {
				result.Matches = append(result.Matches, drivers.DataSearchMatch{Schema: col.schema, Table: col.table, Column: col.column, Value: value})
			}
		}
		found.Close()
	}
	return result, nil
}
