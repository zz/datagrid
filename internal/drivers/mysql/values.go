package mysql

import (
	"database/sql"
	"encoding/base64"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"datagrid/internal/drivers"
)

// encoder maps database/sql values (mostly []byte in the MySQL text
// protocol) to tagged Values using per-column type metadata.
type encoder struct {
	cells   *drivers.CellCache
	queryID drivers.QueryID
	types   []*sql.ColumnType
	n       int
}

func (e *encoder) encode(col int, v any) drivers.Value {
	switch x := v.(type) {
	case nil:
		return drivers.Value{T: "null"}
	case int64:
		return drivers.Value{T: "i64", V: x}
	case uint64:
		if x > math.MaxInt64 {
			return drivers.Value{T: "str", V: strconv.FormatUint(x, 10)}
		}
		return drivers.Value{T: "i64", V: int64(x)}
	case float64:
		return drivers.Value{T: "f64", V: x}
	case bool:
		return drivers.Value{T: "bool", V: x}
	case time.Time:
		return drivers.Value{T: "time", V: x.Format(time.RFC3339Nano)}
	case string:
		return e.byType(col, []byte(x))
	case []byte:
		return e.byType(col, x)
	default:
		return e.str("str", fmt.Sprint(v))
	}
}

// byType interprets a raw text-protocol value using the column's declared
// database type.
func (e *encoder) byType(col int, raw []byte) drivers.Value {
	typeName := ""
	if col < len(e.types) {
		typeName = e.types[col].DatabaseTypeName()
	}
	s := string(raw)
	switch {
	case isIntType(typeName):
		if strings.HasPrefix(typeName, "UNSIGNED") {
			if u, err := strconv.ParseUint(s, 10, 64); err == nil {
				if u > math.MaxInt64 {
					return drivers.Value{T: "str", V: s}
				}
				return drivers.Value{T: "i64", V: int64(u)}
			}
		}
		if i, err := strconv.ParseInt(s, 10, 64); err == nil {
			return drivers.Value{T: "i64", V: i}
		}
		return e.str("str", s)
	case typeName == "FLOAT" || typeName == "DOUBLE":
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return drivers.Value{T: "f64", V: f}
		}
		return e.str("str", s)
	case typeName == "DECIMAL": // exact form, like Postgres numeric
		return e.str("str", s)
	case typeName == "JSON":
		return e.str("json", s)
	case isBinaryType(typeName):
		return e.bytes(raw)
	default:
		return e.str("str", s)
	}
}

func isIntType(t string) bool {
	switch strings.TrimPrefix(t, "UNSIGNED ") {
	case "TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT", "YEAR":
		return true
	}
	return false
}

func isBinaryType(t string) bool {
	return strings.Contains(t, "BLOB") || strings.Contains(t, "BINARY") ||
		t == "BIT" || t == "GEOMETRY"
}

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
