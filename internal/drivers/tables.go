package drivers

import "context"

// ColumnInfo describes one column of a table for the data editor.
type ColumnInfo struct {
	Name     string `json:"name"`
	TypeName string `json:"typeName"`
	Nullable bool   `json:"nullable"`
}

// TableInfo is the metadata the table-data grid needs. An empty PrimaryKey
// means the table has no PK/unique key, so the grid opens read-only
// (design §6).
type TableInfo struct {
	Schema     string       `json:"schema"`
	Table      string       `json:"table"`
	Columns    []ColumnInfo `json:"columns"`
	PrimaryKey []string     `json:"primaryKey"`
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
	Schema  string       `json:"schema"`
	Table   string       `json:"table"`
	Sorts   []SortSpec   `json:"sorts"`
	Filters []FilterSpec `json:"filters"`
	Limit   int          `json:"limit"`
	Offset  int          `json:"offset"`
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
	Kind string               `json:"kind"`
	Key  map[string]CellInput `json:"key"`
	Set  map[string]CellInput `json:"set"`
}

// ChangesetRequest is a batch of edits to apply atomically.
type ChangesetRequest struct {
	Schema  string      `json:"schema"`
	Table   string      `json:"table"`
	Changes []RowChange `json:"changes"`
}

// ChangesetResult reports the outcome of applying a changeset.
type ChangesetResult struct {
	Previews     []string `json:"previews"` // human-readable generated SQL
	RowsAffected int64    `json:"rowsAffected"`
}

// TableEditor is implemented by SQL sessions that support the table-data
// grid: introspecting a table, reading pages, and applying changesets.
type TableEditor interface {
	TableInfo(ctx context.Context, schema, table string) (*TableInfo, error)
	ReadPage(ctx context.Context, req PageRequest) (*Page, error)
	// PreviewChanges returns the generated SQL for a changeset without
	// executing it, so the UI can show it before the user applies.
	PreviewChanges(ctx context.Context, req ChangesetRequest) ([]string, error)
	ApplyChanges(ctx context.Context, req ChangesetRequest) (*ChangesetResult, error)
}
