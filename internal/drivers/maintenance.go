package drivers

import "context"

type TableMaintainer interface {
	MaintainTable(ctx context.Context, schema, table, operation string) (string, error)
}
