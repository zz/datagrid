package mysql

import (
	"context"
	"database/sql"
	"strings"

	"datagrid/internal/drivers"
)

// Explain runs a tabular EXPLAIN and turns each row into a plan node. MySQL's
// EXPLAIN is a flat list of access steps rather than a nested tree, so the
// result is a root with one child per step (design §6).
func (s *session) Explain(ctx context.Context, statement string) (*drivers.PlanNode, error) {
	// FORMAT=TRADITIONAL forces the classic tabular columns; MySQL 8.0.18+
	// defaults EXPLAIN to a TREE-text format for some queries.
	rows, err := s.db.QueryContext(ctx, "EXPLAIN FORMAT=TRADITIONAL "+statement)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	root := &drivers.PlanNode{Label: "Query plan"}
	raw := make([]sql.NullString, len(cols))
	ptrs := make([]any, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		fields := map[string]string{}
		for i, c := range cols {
			if raw[i].Valid {
				fields[c] = raw[i].String
			}
		}
		root.Children = append(root.Children, explainRowNode(fields))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(root.Children) == 0 {
		root.Label = "(empty plan)"
	}
	return root, nil
}

func explainRowNode(f map[string]string) drivers.PlanNode {
	label := f["table"]
	if label == "" {
		label = f["select_type"]
	}
	if label == "" {
		label = "step"
	}
	if st := f["select_type"]; st != "" && st != label {
		label = st + ": " + label
	}

	var details []string
	add := func(key, prefix string) {
		if v := f[key]; v != "" {
			details = append(details, prefix+v)
		}
	}
	add("type", "access=")
	add("key", "key=")
	add("rows", "rows=")
	add("filtered", "filtered=")
	add("Extra", "")
	return drivers.PlanNode{Label: label, Detail: strings.Join(details, "  ")}
}
