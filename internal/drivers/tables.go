package drivers

import "context"

// ColumnInfo describes one column of a table for the data editor. Default is
// the column's raw default expression (empty if none), used by the structure
// editor so an ALTER doesn't silently drop it.
type ColumnInfo struct {
	Name     string `json:"name"`
	TypeName string `json:"typeName"`
	Nullable bool   `json:"nullable"`
	Default  string `json:"default"`
}

// ConstraintInfo describes a named table constraint. Definition is the
// engine-rendered clause and Kind is primary_key, unique, foreign_key, or check.
type ConstraintInfo struct {
	Name       string   `json:"name"`
	Kind       string   `json:"kind"`
	Columns    []string `json:"columns"`
	Definition string   `json:"definition"`
}

// ForeignKeyInfo describes an outbound relationship in column order.
type ForeignKeyInfo struct {
	Name              string   `json:"name"`
	Columns           []string `json:"columns"`
	ReferencedSchema  string   `json:"referencedSchema"`
	ReferencedTable   string   `json:"referencedTable"`
	ReferencedColumns []string `json:"referencedColumns"`
	OnUpdate          string   `json:"onUpdate"`
	OnDelete          string   `json:"onDelete"`
}

// TableInfo is the metadata the table-data grid needs. An empty PrimaryKey
// means the table has no PK/unique key, so the grid opens read-only
// (design §6).
type TableInfo struct {
	Schema      string           `json:"schema"`
	Table       string           `json:"table"`
	Columns     []ColumnInfo     `json:"columns"`
	PrimaryKey  []string         `json:"primaryKey"`
	Constraints []ConstraintInfo `json:"constraints"`
	ForeignKeys []ForeignKeyInfo `json:"foreignKeys"`
	Indexes     []IndexInfo      `json:"indexes"`
}

// SortSpec is one ORDER BY term.
type SortSpec struct {
	Column string `json:"column"`
	Desc   bool   `json:"desc"`
}

// FilterSpec is one WHERE condition. Op is validated against a whitelist.
type FilterSpec struct {
	Column string `json:"column"`
	Op     string `json:"op"` // = != < > <= >= contains starts
	Value  string `json:"value"`
}

// PageRequest describes a page of table data to read.
type PageRequest struct {
	Schema string `json:"schema"`
	Table  string `json:"table"`
	// WhereRaw is a raw SQL boolean expression (the user's own filter, e.g.
	// "id > 100 AND created_at > '1999-01-01'"), ANDed with any structured
	// Filters. Inlined, not parameterized — same trust model as the console.
	WhereRaw string       `json:"whereRaw"`
	Sorts    []SortSpec   `json:"sorts"`
	Filters  []FilterSpec `json:"filters"`
	Limit    int          `json:"limit"`
	Offset   int          `json:"offset"`
}

// Page is a synchronously-returned page of table rows.
type Page struct {
	Columns []Column `json:"columns"`
	Rows    [][]any  `json:"rows"` // cells are tagged Values
	HasMore bool     `json:"hasMore"`
}

// CellInput is an editable cell value crossing IPC: either SQL NULL or text
// that the driver binds as a parameter (the server coerces to column type).
type CellInput struct {
	Null bool   `json:"null"`
	Text string `json:"text"`
}

// RowChange is one pending edit. Kind is insert | update | delete.
// Key identifies the target row by primary key (update/delete). Set holds
// new column values (insert/update).
type RowChange struct {
	Kind     string               `json:"kind"`
	Key      map[string]CellInput `json:"key"`
	Set      map[string]CellInput `json:"set"`
	Original map[string]CellInput `json:"original,omitempty"`
}

// ChangesetRequest is a batch of edits to apply atomically.
type ChangesetRequest struct {
	Schema  string      `json:"schema"`
	Table   string      `json:"table"`
	Changes []RowChange `json:"changes"`
	Force   bool        `json:"force,omitempty"`
}

// ChangeConflict identifies a stale update or delete. The entire changeset is
// rolled back when any target no longer matches its originally loaded values.
type ChangeConflict struct {
	ChangeIndex int                  `json:"changeIndex"`
	Kind        string               `json:"kind"`
	Key         map[string]CellInput `json:"key"`
	Reason      string               `json:"reason"`
}

// ChangesetResult reports the outcome of applying a changeset.
type ChangesetResult struct {
	Previews     []string         `json:"previews"` // human-readable generated SQL
	RowsAffected int64            `json:"rowsAffected"`
	Conflicts    []ChangeConflict `json:"conflicts,omitempty"`
}

// TableEditor is implemented by SQL sessions that support the table-data
// grid: introspecting a table, reading pages, and applying changesets.
type TableEditor interface {
	TableInfo(ctx context.Context, schema, table string) (*TableInfo, error)
	ReadPage(ctx context.Context, req PageRequest) (*Page, error)
	// CountRows returns the total matching rows for a request's filters, used
	// to enable last-page navigation and show a total.
	CountRows(ctx context.Context, req PageRequest) (int64, error)
	// PreviewChanges returns the generated SQL for a changeset without
	// executing it, so the UI can show it before the user applies.
	PreviewChanges(ctx context.Context, req ChangesetRequest) ([]string, error)
	ApplyChanges(ctx context.Context, req ChangesetRequest) (*ChangesetResult, error)
}
