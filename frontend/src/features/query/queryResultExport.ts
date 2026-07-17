import type { Column, Value } from '../../ipc/types'
import type { ResultRange } from './resultSelection'
import { selectResultRange } from './resultSelection'

export type QueryResultExportScope = 'selection' | 'visible' | 'loaded'

export interface QueryResultExportData {
    columns: Column[]
    rows: Value[][]
}

export function queryResultExportData(
    scope: QueryResultExportScope,
    columns: Column[],
    rows: Value[][],
    shownRows: Value[][],
    visibleColumnIndexes: number[],
    selection?: ResultRange,
): QueryResultExportData | null {
    if (scope === 'selection') {
        const selected = selectResultRange(columns, shownRows, visibleColumnIndexes, selection)
        return selected ? { columns: selected.columns, rows: selected.rows } : null
    }
    if (scope === 'visible') return {
        columns: visibleColumnIndexes.map(index => columns[index]),
        rows: shownRows.map(row => visibleColumnIndexes.map(index => row[index] ?? { t: 'null' })),
    }
    return { columns, rows }
}
