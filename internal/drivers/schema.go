package drivers

import (
	"context"
	"fmt"
	"strings"
)

// ColumnSpec describes a column for CREATE TABLE and ADD COLUMN. Type and
// Default are raw engine-native SQL (same trust model as the console): the
// caller supplies e.g. "varchar(255)" or "now()".
type ColumnSpec struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Nullable   bool   `json:"nullable"`
	PrimaryKey bool   `json:"primaryKey"`
	Default    string `json:"default"`
}

// TableSpec describes a table for CREATE TABLE.
type TableSpec struct {
	Schema  string       `json:"schema"`
	Name    string       `json:"name"`
	Columns []ColumnSpec `json:"columns"`
}

// IndexInfo describes an existing index for the index manager.
type IndexInfo struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
	Unique  bool     `json:"unique"`
}

// IndexSpec describes an index to create.
type IndexSpec struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
	Unique  bool     `json:"unique"`
}

// SchemaEditor is implemented by SQL sessions that support DDL (creating and
// altering databases, tables, columns, and indexes). Redis and other non-SQL
// engines do not implement it.
type SchemaEditor interface {
	CreateDatabase(ctx context.Context, name string) error
	DropDatabase(ctx context.Context, name string) error
	CreateTable(ctx context.Context, spec TableSpec) error
	DropTable(ctx context.Context, schema, table string) error
	RenameTable(ctx context.Context, schema, table, newName string) error
	AddColumn(ctx context.Context, schema, table string, col ColumnSpec) error
	DropColumn(ctx context.Context, schema, table, column string) error
	RenameColumn(ctx context.Context, schema, table, column, newName string) error
	// ModifyColumn changes an existing column's name, type, nullability, and
	// default in one step (oldName identifies it; spec holds the new state).
	ModifyColumn(ctx context.Context, schema, table, oldName string, spec ColumnSpec) error
	// SetPrimaryKey replaces the table's primary key with the given columns;
	// an empty slice drops the primary key.
	SetPrimaryKey(ctx context.Context, schema, table string, columns []string) error
	ListIndexes(ctx context.Context, schema, table string) ([]IndexInfo, error)
	CreateIndex(ctx context.Context, schema, table string, spec IndexSpec) error
	DropIndex(ctx context.Context, schema, table, name string) error
}

// QualifiedName exposes schema-qualified identifier quoting to the per-engine
// driver packages (e.g. for DROP INDEX, which they build themselves).
func (d Dialect) QualifiedName(schema, name string) string {
	return d.qualified(schema, name)
}

// ColumnDef exposes column-definition rendering to the driver packages (e.g.
// MySQL's CHANGE COLUMN, which builds the statement itself).
func (d Dialect) ColumnDef(col ColumnSpec) (string, error) {
	return d.columnDef(col)
}

// columnDef renders one column definition, e.g. `"name" varchar(255) NOT NULL
// DEFAULT ”`. The type and default are inlined verbatim.
func (d Dialect) columnDef(col ColumnSpec) (string, error) {
	if strings.TrimSpace(col.Name) == "" {
		return "", fmt.Errorf("column name is required")
	}
	if strings.TrimSpace(col.Type) == "" {
		return "", fmt.Errorf("column %q needs a type", col.Name)
	}
	parts := []string{d.Quote(col.Name), col.Type}
	if !col.Nullable {
		parts = append(parts, "NOT NULL")
	}
	if def := strings.TrimSpace(col.Default); def != "" {
		parts = append(parts, "DEFAULT "+def)
	}
	return strings.Join(parts, " "), nil
}

// BuildCreateTable renders a CREATE TABLE with an inline PRIMARY KEY clause
// for any columns flagged as key. The syntax is shared by Postgres and MySQL.
func (d Dialect) BuildCreateTable(spec TableSpec) (string, error) {
	if strings.TrimSpace(spec.Name) == "" {
		return "", fmt.Errorf("table name is required")
	}
	if len(spec.Columns) == 0 {
		return "", fmt.Errorf("a table needs at least one column")
	}
	defs := make([]string, 0, len(spec.Columns)+1)
	var pk []string
	for _, c := range spec.Columns {
		def, err := d.columnDef(c)
		if err != nil {
			return "", err
		}
		defs = append(defs, def)
		if c.PrimaryKey {
			pk = append(pk, d.Quote(c.Name))
		}
	}
	if len(pk) > 0 {
		defs = append(defs, "PRIMARY KEY ("+strings.Join(pk, ", ")+")")
	}
	return fmt.Sprintf("CREATE TABLE %s (%s)", d.qualified(spec.Schema, spec.Name), strings.Join(defs, ", ")), nil
}

// BuildDropTable renders DROP TABLE for a qualified table.
func (d Dialect) BuildDropTable(schema, table string) string {
	return "DROP TABLE " + d.qualified(schema, table)
}

// BuildRenameTable renders ALTER TABLE ... RENAME TO. The new name is
// unqualified (the table stays in its schema).
func (d Dialect) BuildRenameTable(schema, table, newName string) string {
	return fmt.Sprintf("ALTER TABLE %s RENAME TO %s", d.qualified(schema, table), d.Quote(newName))
}

// BuildAddColumn renders ALTER TABLE ... ADD COLUMN.
func (d Dialect) BuildAddColumn(schema, table string, col ColumnSpec) (string, error) {
	def, err := d.columnDef(col)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s", d.qualified(schema, table), def), nil
}

// BuildDropColumn renders ALTER TABLE ... DROP COLUMN.
func (d Dialect) BuildDropColumn(schema, table, column string) string {
	return fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", d.qualified(schema, table), d.Quote(column))
}

// BuildRenameColumn renders ALTER TABLE ... RENAME COLUMN ... TO. Supported by
// Postgres and MySQL 8.0+/MariaDB 10.5.2+.
func (d Dialect) BuildRenameColumn(schema, table, column, newName string) string {
	return fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", d.qualified(schema, table), d.Quote(column), d.Quote(newName))
}

// BuildCreateIndex renders CREATE [UNIQUE] INDEX name ON table (cols). Shared
// by Postgres and MySQL. DROP INDEX differs per engine, so it is built in each
// driver instead.
func (d Dialect) BuildCreateIndex(schema, table string, spec IndexSpec) (string, error) {
	if strings.TrimSpace(spec.Name) == "" {
		return "", fmt.Errorf("index name is required")
	}
	if len(spec.Columns) == 0 {
		return "", fmt.Errorf("an index needs at least one column")
	}
	cols := make([]string, len(spec.Columns))
	for i, c := range spec.Columns {
		cols[i] = d.Quote(c)
	}
	unique := ""
	if spec.Unique {
		unique = "UNIQUE "
	}
	return fmt.Sprintf("CREATE %sINDEX %s ON %s (%s)", unique, d.Quote(spec.Name), d.qualified(schema, table), strings.Join(cols, ", ")), nil
}

// BuildCreateDatabase renders CREATE DATABASE for a bare database name.
func (d Dialect) BuildCreateDatabase(name string) string {
	return "CREATE DATABASE " + d.Quote(name)
}

// BuildDropDatabase renders DROP DATABASE for a bare database name.
func (d Dialect) BuildDropDatabase(name string) string {
	return "DROP DATABASE " + d.Quote(name)
}
