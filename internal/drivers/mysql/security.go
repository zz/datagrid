package mysql

import (
	"context"
	"strings"

	"datagrid/internal/drivers"
)

func (s *session) ListDatabasePrincipals(ctx context.Context) ([]drivers.DatabasePrincipal, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.table_privileges
UNION ALL
SELECT grantee, table_schema, '*', privilege_type
FROM information_schema.schema_privileges
UNION ALL
SELECT grantee, '*', '*', privilege_type
FROM information_schema.user_privileges
ORDER BY grantee, table_schema, table_name, privilege_type`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []drivers.DatabasePrincipal
	byAccount := map[string]int{}
	for rows.Next() {
		var account, schema, table, privilege string
		if err := rows.Scan(&account, &schema, &table, &privilege); err != nil {
			return nil, err
		}
		index, ok := byAccount[account]
		if !ok {
			name, host := mysqlAccount(account)
			item := drivers.DatabasePrincipal{Name: name, Host: host, Login: true}
			byAccount[account] = len(out)
			out = append(out, item)
			index = len(out) - 1
		}
		if privilege == "SUPER" || privilege == "ALL PRIVILEGES" {
			out[index].Admin = true
		}
		out[index].Grants = append(out[index].Grants, privilege+" on "+schema+"."+table)
	}
	return out, rows.Err()
}

func mysqlAccount(value string) (string, string) {
	parts := strings.SplitN(value, "@", 2)
	trim := func(text string) string { return strings.Trim(text, "'`") }
	if len(parts) == 1 {
		return trim(parts[0]), ""
	}
	return trim(parts[0]), trim(parts[1])
}
