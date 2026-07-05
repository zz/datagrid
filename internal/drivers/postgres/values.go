package postgres

import (
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"datagrid/internal/drivers"
)

type encoder struct {
	cells   *drivers.CellCache
	queryID drivers.QueryID
	n       int
}

func (e *encoder) encode(v any) drivers.Value {
	switch x := v.(type) {
	case nil:
		return drivers.Value{T: "null"}
	case int64:
		return drivers.Value{T: "i64", V: x}
	case int32:
		return drivers.Value{T: "i64", V: int64(x)}
	case int16:
		return drivers.Value{T: "i64", V: int64(x)}
	case float64:
		return drivers.Value{T: "f64", V: x}
	case float32:
		return drivers.Value{T: "f64", V: float64(x)}
	case bool:
		return drivers.Value{T: "bool", V: x}
	case string:
		return e.str("str", x)
	case time.Time:
		return drivers.Value{T: "time", V: x.Format(time.RFC3339Nano)}
	case []byte:
		return e.bytes(x)
	case [16]byte: // uuid
		return drivers.Value{T: "str", V: formatUUID(x)}
	case map[string]any, []any:
		blob, err := json.Marshal(x)
		if err != nil {
			return drivers.Value{T: "str", V: fmt.Sprint(x)}
		}
		return e.str("json", string(blob))
	default:
		// pgtype wrappers (numeric, inet, ...) mostly implement
		// driver.Valuer with a faithful text form.
		if val, ok := v.(driver.Valuer); ok {
			if dv, err := val.Value(); err == nil {
				if s, ok := dv.(string); ok {
					return e.str("str", s)
				}
				if dv != nil {
					return e.encode(dv)
				}
				return drivers.Value{T: "null"}
			}
		}
		return e.str("str", fmt.Sprint(v))
	}
}

// str truncates oversized text-ish values, retaining the full value for
// the cell inspector.
func (e *encoder) str(tag, s string) drivers.Value {
	if len(s) > drivers.CellTruncateAt {
		ref := e.cells.Put(e.queryID, e.n, drivers.Value{T: tag, V: s})
		e.n++
		return drivers.Value{T: tag, V: s[:drivers.CellTruncateAt], Ref: ref}
	}
	return drivers.Value{T: tag, V: s}
}

func (e *encoder) bytes(b []byte) drivers.Value {
	if len(b) > drivers.CellTruncateAt {
		full := drivers.Value{T: "bytes", V: base64.StdEncoding.EncodeToString(b)}
		ref := e.cells.Put(e.queryID, e.n, full)
		e.n++
		return drivers.Value{T: "bytes", V: base64.StdEncoding.EncodeToString(b[:drivers.CellTruncateAt]), Ref: ref}
	}
	return drivers.Value{T: "bytes", V: base64.StdEncoding.EncodeToString(b)}
}

func formatUUID(b [16]byte) string {
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
