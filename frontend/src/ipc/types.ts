// Mirrors of the Go event payload types (internal/drivers). Types used in
// bound-method signatures are generated into wailsjs/go/models.ts; these
// only ride on runtime events, so they are declared by hand.

export interface Value {
    t: string // null | i64 | f64 | bool | str | time | bytes | json
    v?: unknown
    ref?: string // set when the cell was truncated; FetchCell resolves it
}

export interface Column {
    name: string
    typeName: string
}

export interface RowBatch {
    queryId: string
    columns?: Column[]
    rows: Value[][]
    seq: number
}

export interface QuerySummary {
    queryId: string
    rowsAffected: number
    rowsReturned: number
    durationMs: number
    truncated: boolean
    error?: string
}

export function displayValue(v: Value): string {
    switch (v.t) {
        case 'null':
            return 'NULL'
        case 'bytes':
            return `0x… (${v.ref ? 'large ' : ''}base64) ${String(v.v).slice(0, 64)}`
        default:
            return String(v.v ?? '')
    }
}
