package drivers

import (
	"fmt"
	"sort"
	"strings"
)

// Dialect captures the per-engine differences the shared SQL builders need.
type Dialect struct {
	// Quote quotes an identifier (Postgres "x", MySQL `x`).
	Quote func(string) string
	// Param renders the n-th (1-based) bind placeholder ($1 vs ?).
	Param func(n int) string
}

// filterOps maps UI operators to SQL. "contains"/"starts" become LIKE with
// a wrapped value supplied by the caller.
var filterOps = map[string]string{
	"=": "=", "!=": "<>", "<": "<", ">": ">", "<=": "<=", ">=": ">=",
	"contains": "LIKE", "starts": "LIKE",
}

func (d Dialect) qualified(schema, table string) string {
	if schema == "" {
		return d.Quote(table)
	}
	return d.Quote(schema) + "." + d.Quote(table)
}

// BuildSelectPage builds a parameterized page query and its args.
func (d Dialect) BuildSelectPage(req PageRequest) (string, []any, error) {
	var sb strings.Builder
	args := []any{}
	n := 0
	next := func() string { n++; return d.Param(n) }

	sb.WriteString("SELECT * FROM ")
	sb.WriteString(d.qualified(req.Schema, req.Table))

	if len(req.Filters) > 0 {
		conds := make([]string, 0, len(req.Filters))
		for _, f := range req.Filters {
			op, ok := filterOps[f.Op]
			if !ok {
				return "", nil, fmt.Errorf("unsupported filter op %q", f.Op)
			}
			val := f.Value
			switch f.Op {
			case "contains":
				val = "%" + f.Value + "%"
			case "starts":
				val = f.Value + "%"
			}
			conds = append(conds, fmt.Sprintf("%s %s %s", d.Quote(f.Column), op, next()))
			args = append(args, val)
		}
		sb.WriteString(" WHERE ")
		sb.WriteString(strings.Join(conds, " AND "))
	}

	if len(req.Sorts) > 0 {
		terms := make([]string, 0, len(req.Sorts))
		for _, s := range req.Sorts {
			dir := ""
			if s.Desc {
				dir = " DESC"
			}
			terms = append(terms, d.Quote(s.Column)+dir)
		}
		sb.WriteString(" ORDER BY ")
		sb.WriteString(strings.Join(terms, ", "))
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 200
	}
	sb.WriteString(" LIMIT ")
	sb.WriteString(next())
	args = append(args, limit)
	if req.Offset > 0 {
		sb.WriteString(" OFFSET ")
		sb.WriteString(next())
		args = append(args, req.Offset)
	}
	return sb.String(), args, nil
}

// Statement is one generated changeset statement: a preview with inlined
// literals plus the parameterized form actually executed.
type Statement struct {
	Preview string
	SQL     string
	Args    []any
}

func sortedKeys(m map[string]CellInput) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func argOf(c CellInput) any {
	if c.Null {
		return nil
	}
	return c.Text
}

// previewLiteral renders a value for the human-readable preview only.
func previewLiteral(c CellInput) string {
	if c.Null {
		return "NULL"
	}
	return "'" + strings.ReplaceAll(c.Text, "'", "''") + "'"
}

// BuildChangeset turns a changeset into ordered statements. PK column names
// are required for update/delete.
func (d Dialect) BuildChangeset(req ChangesetRequest, pk []string) ([]Statement, error) {
	if len(req.Changes) == 0 {
		return nil, nil
	}
	qtable := d.qualified(req.Schema, req.Table)
	out := make([]Statement, 0, len(req.Changes))

	for _, ch := range req.Changes {
		switch ch.Kind {
		case "insert":
			cols := sortedKeys(ch.Set)
			if len(cols) == 0 {
				return nil, fmt.Errorf("insert with no columns")
			}
			qcols := make([]string, len(cols))
			ph := make([]string, len(cols))
			pv := make([]string, len(cols))
			args := make([]any, len(cols))
			for i, c := range cols {
				qcols[i] = d.Quote(c)
				ph[i] = d.Param(i + 1)
				pv[i] = previewLiteral(ch.Set[c])
				args[i] = argOf(ch.Set[c])
			}
			body := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", qtable, strings.Join(qcols, ", "), strings.Join(ph, ", "))
			preview := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", qtable, strings.Join(qcols, ", "), strings.Join(pv, ", "))
			out = append(out, Statement{Preview: preview, SQL: body, Args: args})

		case "update":
			if len(pk) == 0 {
				return nil, fmt.Errorf("cannot update a table without a primary key")
			}
			cols := sortedKeys(ch.Set)
			if len(cols) == 0 {
				continue // nothing changed
			}
			n := 0
			setSQL := make([]string, len(cols))
			setPrev := make([]string, len(cols))
			args := make([]any, 0, len(cols)+len(pk))
			for i, c := range cols {
				n++
				setSQL[i] = fmt.Sprintf("%s = %s", d.Quote(c), d.Param(n))
				setPrev[i] = fmt.Sprintf("%s = %s", d.Quote(c), previewLiteral(ch.Set[c]))
				args = append(args, argOf(ch.Set[c]))
			}
			whereSQL, wherePrev, wargs, err := d.pkWhere(ch.Key, pk, &n)
			if err != nil {
				return nil, err
			}
			args = append(args, wargs...)
			body := fmt.Sprintf("UPDATE %s SET %s WHERE %s", qtable, strings.Join(setSQL, ", "), whereSQL)
			preview := fmt.Sprintf("UPDATE %s SET %s WHERE %s", qtable, strings.Join(setPrev, ", "), wherePrev)
			out = append(out, Statement{Preview: preview, SQL: body, Args: args})

		case "delete":
			if len(pk) == 0 {
				return nil, fmt.Errorf("cannot delete from a table without a primary key")
			}
			n := 0
			whereSQL, wherePrev, wargs, err := d.pkWhere(ch.Key, pk, &n)
			if err != nil {
				return nil, err
			}
			body := fmt.Sprintf("DELETE FROM %s WHERE %s", qtable, whereSQL)
			preview := fmt.Sprintf("DELETE FROM %s WHERE %s", qtable, wherePrev)
			out = append(out, Statement{Preview: preview, SQL: body, Args: wargs})

		default:
			return nil, fmt.Errorf("unknown change kind %q", ch.Kind)
		}
	}
	return out, nil
}

// pkWhere builds the "pk1 = $n AND ..." clause. n is advanced in place so
// the placeholders continue a statement's existing parameter sequence.
func (d Dialect) pkWhere(key map[string]CellInput, pk []string, n *int) (sql, preview string, args []any, err error) {
	conds := make([]string, len(pk))
	prevs := make([]string, len(pk))
	for i, col := range pk {
		v, ok := key[col]
		if !ok {
			return "", "", nil, fmt.Errorf("missing primary key value for %q", col)
		}
		*n++
		conds[i] = fmt.Sprintf("%s = %s", d.Quote(col), d.Param(*n))
		prevs[i] = fmt.Sprintf("%s = %s", d.Quote(col), previewLiteral(v))
		args = append(args, argOf(v))
	}
	return strings.Join(conds, " AND "), strings.Join(prevs, " AND "), args, nil
}
