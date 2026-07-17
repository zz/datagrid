package postgres

import (
	"context"
	"fmt"
	"strings"
)

func (s *session) ObjectDDL(ctx context.Context, kind, schema, name string) (string, error) {
	switch kind {
	case "view":
		var definition, relkind string
		err := s.pool.QueryRow(ctx, `SELECT pg_catalog.pg_get_viewdef(c.oid, true), c.relkind::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('v','m')`, schema, name).Scan(&definition, &relkind)
		if err != nil {
			return "", err
		}
		prefix := "CREATE OR REPLACE VIEW"
		if relkind == "m" {
			prefix = "CREATE MATERIALIZED VIEW"
		}
		return fmt.Sprintf("%s %s AS\n%s;", prefix, dialect.QualifiedName(schema, name), strings.TrimSuffix(definition, ";")), nil
	case "routine":
		var definition string
		err := s.pool.QueryRow(ctx, `SELECT pg_catalog.pg_get_functiondef(p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2 ORDER BY p.oid LIMIT 1`, schema, name).Scan(&definition)
		return definition, err
	case "trigger":
		var definition string
		err := s.pool.QueryRow(ctx, `SELECT pg_catalog.pg_get_triggerdef(t.oid, true) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND t.tgname=$2 AND NOT t.tgisinternal`, schema, name).Scan(&definition)
		if err != nil {
			return "", err
		}
		return definition + ";", nil
	case "sequence":
		var dataType, start, min, max, increment string
		var cycle bool
		err := s.pool.QueryRow(ctx, `SELECT data_type, start_value::text, minimum_value::text, maximum_value::text, increment::text, cycle_option='YES' FROM information_schema.sequences WHERE sequence_schema=$1 AND sequence_name=$2`, schema, name).Scan(&dataType, &start, &min, &max, &increment, &cycle)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("CREATE SEQUENCE %s\n    AS %s\n    INCREMENT BY %s\n    MINVALUE %s\n    MAXVALUE %s\n    START WITH %s\n    %s;", dialect.QualifiedName(schema, name), dataType, increment, min, max, start, map[bool]string{true: "CYCLE", false: "NO CYCLE"}[cycle]), nil
	case "table":
		return s.tableDDL(ctx, schema, name)
	default:
		return "", fmt.Errorf("DDL is not supported for object kind %q", kind)
	}
}

func (s *session) tableDDL(ctx context.Context, schema, table string) (string, error) {
	info, err := s.TableInfo(ctx, schema, table)
	if err != nil {
		return "", err
	}
	definitions := make([]string, 0, len(info.Columns)+len(info.Constraints))
	for _, column := range info.Columns {
		line := "    " + dialect.Quote(column.Name) + " " + column.TypeName
		if column.Default != "" {
			line += " DEFAULT " + column.Default
		}
		if !column.Nullable {
			line += " NOT NULL"
		}
		definitions = append(definitions, line)
	}
	for _, constraint := range info.Constraints {
		definitions = append(definitions, "    CONSTRAINT "+dialect.Quote(constraint.Name)+" "+constraint.Definition)
	}
	ddl := "CREATE TABLE " + dialect.QualifiedName(schema, table) + " (\n" + strings.Join(definitions, ",\n") + "\n);"
	constraintNames := map[string]bool{}
	for _, constraint := range info.Constraints {
		constraintNames[constraint.Name] = true
	}
	for _, index := range info.Indexes {
		if constraintNames[index.Name] {
			continue
		}
		var definition string
		if err := s.pool.QueryRow(ctx, `SELECT pg_catalog.pg_get_indexdef(i.indexrelid) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class t ON t.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace JOIN pg_catalog.pg_class x ON x.oid=i.indexrelid WHERE n.nspname=$1 AND t.relname=$2 AND x.relname=$3`, schema, table, index.Name).Scan(&definition); err == nil {
			ddl += "\n\n" + definition + ";"
		}
	}
	return ddl, nil
}
