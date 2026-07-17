package postgres

import (
	"context"
	"fmt"

	"datagrid/internal/drivers"
)

func (s *session) ListDatabasePrincipals(ctx context.Context) ([]drivers.DatabasePrincipal, error) {
	rows, err := s.pool.Query(ctx, `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_catalog.pg_roles ORDER BY rolname`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []drivers.DatabasePrincipal
	byName := map[string]int{}
	for rows.Next() {
		var item drivers.DatabasePrincipal
		var createDB, createRole, replication, bypassRLS bool
		if err := rows.Scan(&item.Name, &item.Login, &item.Admin, &createDB, &createRole, &replication, &bypassRLS); err != nil {
			return nil, err
		}
		if createDB {
			item.Attributes = append(item.Attributes, "Create database")
		}
		if createRole {
			item.Attributes = append(item.Attributes, "Create role")
		}
		if replication {
			item.Attributes = append(item.Attributes, "Replication")
		}
		if bypassRLS {
			item.Attributes = append(item.Attributes, "Bypass RLS")
		}
		byName[item.Name] = len(out)
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	grants, err := s.pool.Query(ctx, `SELECT grantee, privilege_type, table_schema, count(*) FROM information_schema.role_table_grants GROUP BY grantee, privilege_type, table_schema ORDER BY grantee, table_schema, privilege_type`)
	if err != nil {
		return nil, err
	}
	defer grants.Close()
	for grants.Next() {
		var name, privilege, schema string
		var count int
		if err := grants.Scan(&name, &privilege, &schema, &count); err != nil {
			return nil, err
		}
		if index, ok := byName[name]; ok {
			out[index].Grants = append(out[index].Grants, fmt.Sprintf("%s on %d objects in %s", privilege, count, schema))
		}
	}
	return out, grants.Err()
}
