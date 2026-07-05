import { SaveTextFile } from '../wailsjs/go/api/App'
import type { Column, Value } from './ipc/types'

// cellScalar returns a cell's underlying value for structured export:
// null for SQL NULL, the raw JS value otherwise.
function cellScalar(cell: Value | undefined): unknown {
    if (!cell || cell.t === 'null') return null
    return cell.v ?? null
}

// cellString renders a cell as plain text for CSV/TSV.
function cellString(cell: Value | undefined): string {
    if (!cell || cell.t === 'null') return ''
    return String(cell.v ?? '')
}

function csvField(s: string): string {
    // Quote when the value contains a delimiter, quote, or newline.
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
}

export function toCSV(columns: Column[], rows: Value[][]): string {
    const header = columns.map(c => csvField(c.name)).join(',')
    const body = rows.map(r => columns.map((_, i) => csvField(cellString(r[i]))).join(','))
    return [header, ...body].join('\n')
}

export function toJSON(columns: Column[], rows: Value[][]): string {
    const objs = rows.map(r => {
        const o: Record<string, unknown> = {}
        columns.forEach((c, i) => {
            o[c.name] = cellScalar(r[i])
        })
        return o
    })
    return JSON.stringify(objs, null, 2)
}

export type ExportFormat = 'csv' | 'json'

// exportRows serializes the rows and prompts the user for a save location.
// Returns the saved path, or '' if cancelled.
export async function exportRows(
    baseName: string,
    format: ExportFormat,
    columns: Column[],
    rows: Value[][],
): Promise<string> {
    const content = format === 'csv' ? toCSV(columns, rows) : toJSON(columns, rows)
    return SaveTextFile(`${baseName}.${format}`, content)
}
