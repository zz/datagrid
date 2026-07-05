// Package drivers defines the engine-agnostic driver layer (design §4).
// The UI never branches on engine type except where capabilities differ.
package drivers

import (
	"context"
	"net"
)

// Engine identifies a database engine family.
type Engine string

const (
	EngineMySQL    Engine = "mysql" // covers MariaDB via vendor probe at connect time
	EnginePostgres Engine = "postgres"
	EngineRedis    Engine = "redis" // covers Valkey
)

// Capabilities describes what a driver supports so the UI can adapt.
type Capabilities struct {
	SQL               bool `json:"sql"`
	KV                bool `json:"kv"`
	MultipleDatabases bool `json:"multipleDatabases"`
}

// ConnectionConfig is the non-secret part of a connection definition.
// Secrets are resolved from the SecretStore by reference, never stored here.
type ConnectionConfig struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Engine   Engine  `json:"engine"`
	Host     string  `json:"host"`
	Port     int     `json:"port"`
	Database string  `json:"database"`
	User     string  `json:"user"`
	TLSMode  string  `json:"tlsMode"`
	SSH      *SSHCfg `json:"ssh,omitempty"`
	ReadOnly bool    `json:"readOnly"`
	EnvLabel string  `json:"envLabel"` // dev | staging | prod
	ColorTag string  `json:"colorTag"`
	Group    string  `json:"group"` // sidebar folder; empty = ungrouped
}

// SSHCfg configures an optional SSH tunnel for a connection.
type SSHCfg struct {
	Host    string `json:"host"`
	Port    int    `json:"port"`
	User    string `json:"user"`
	KeyPath string `json:"keyPath"`
	// Auth method resolution (agent, key, password) lives in internal/tunnel.
}

// ConnectOptions carries what a driver needs beyond the stored config:
// the resolved secret and, when an SSH tunnel is configured, a dialer that
// routes through it. Resolving both is internal/api's job, so drivers never
// touch the secret store or the tunnel manager.
type ConnectOptions struct {
	Password string
	Dialer   func(ctx context.Context, network, addr string) (net.Conn, error)
}

// QueryID identifies a running query for cancellation.
type QueryID string

// QueryRequest is a single statement (or raw Redis command) to execute.
type QueryRequest struct {
	QueryID   QueryID `json:"queryId"`
	Statement string  `json:"statement"`
	MaxRows   int     `json:"maxRows"` // page cap before UI switches to explicit paging
	// Args are optional bound parameters (used by table paging/filtering).
	Args []any `json:"-"`
}

// QuerySummary is returned once a query finishes or fails.
type QuerySummary struct {
	QueryID      QueryID `json:"queryId"`
	RowsAffected int64   `json:"rowsAffected"`
	RowsReturned int64   `json:"rowsReturned"`
	DurationMs   int64   `json:"durationMs"`
	// Truncated means the result hit QueryRequest.MaxRows and the UI
	// should offer explicit paging.
	Truncated bool   `json:"truncated"`
	Error     string `json:"error,omitempty"`
}

// Column describes one result column.
type Column struct {
	Name     string `json:"name"`
	TypeName string `json:"typeName"` // engine-native type name
}

// RowBatch is one streamed chunk of results (~500 rows / 256 KB).
// Columns is set only on the first batch (Seq == 0).
type RowBatch struct {
	QueryID QueryID  `json:"queryId"`
	Columns []Column `json:"columns,omitempty"`
	Rows    [][]any  `json:"rows"` // cells are tagged values, see Value
	Seq     int      `json:"seq"`
}

// Value is a tagged cell value so the grid can render/edit type-faithfully:
// {"t":"i64","v":...}, {"t":"bytes","v":"<base64>"}, {"t":"null"}, ...
type Value struct {
	T string `json:"t"`
	V any    `json:"v,omitempty"`
	// Ref is set instead of V for oversized cells; the cell inspector
	// fetches the full value on demand.
	Ref string `json:"ref,omitempty"`
}

// ApproxSize estimates the serialized size of a value for batch sizing.
func (v Value) ApproxSize() int {
	switch x := v.V.(type) {
	case string:
		return len(x) + 16
	default:
		return 24
	}
}

// RowSink receives streamed row batches from Session.Execute.
type RowSink func(batch RowBatch)

// IntrospectScope narrows introspection to one level of the schema tree
// so the sidebar can expand lazily.
type IntrospectScope struct {
	Database string `json:"database,omitempty"`
	Schema   string `json:"schema,omitempty"`
	Table    string `json:"table,omitempty"`
}

// SchemaNode is one node in the schema tree (database, schema, table, view,
// routine, column — or Redis database / key-pattern group).
type SchemaNode struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	// Detail is secondary display text, e.g. a column's type.
	Detail   string       `json:"detail,omitempty"`
	Children []SchemaNode `json:"children,omitempty"`
	// HasChildren signals the UI to show an expander even when Children
	// haven't been introspected yet.
	HasChildren bool `json:"hasChildren"`
}

// SchemaTree is the introspection result for one scope.
type SchemaTree struct {
	Nodes []SchemaNode `json:"nodes"`
}

// Driver creates sessions for one engine family.
type Driver interface {
	Connect(ctx context.Context, cfg *ConnectionConfig, opts ConnectOptions) (Session, error)
	Capabilities() Capabilities
}

// CellFetcher is implemented by sessions that retain oversized cell values
// for the cell inspector; resolve a Value.Ref to the full value.
type CellFetcher interface {
	FetchCell(ref string) (*Value, bool)
}

// AutocompleteProvider is implemented by SQL sessions that can produce a
// flat "schema.table" → column-names map to feed editor autocomplete.
type AutocompleteProvider interface {
	AutocompleteMap(ctx context.Context) (map[string][]string, error)
}

// DatabaseLister is implemented by SQL sessions that can list the databases
// on the server, for the connection's database switcher.
type DatabaseLister interface {
	ListServerDatabases(ctx context.Context) ([]string, error)
}

// Session is one live connection (backed by a pool for SQL engines).
type Session interface {
	Ping(ctx context.Context) error
	Introspect(ctx context.Context, scope IntrospectScope) (*SchemaTree, error)
	Execute(ctx context.Context, req QueryRequest, sink RowSink) (*QuerySummary, error)
	Cancel(ctx context.Context, queryID QueryID) error
	Close() error
}
