import type { Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'
import type { ResultRange } from './resultSelection'

export interface ResultReplaceOptions {
    find: string
    replace: string
    matchCase: boolean
    wholeCell: boolean
    selectionOnly: boolean
}

export interface ResultReplaceSelection {
    ranges: ResultRange[]
    rows: number[]
    columns: number[]
}

export interface ResultReplacement {
    rowIndex: number
    columnIndex: number
    text: string
    isNull: false
    before: string
}

function inRange(column: number, row: number, range: ResultRange): boolean {
    return column >= range.x && column < range.x + range.width && row >= range.y && row < range.y + range.height
}

function replaceText(value: string, options: ResultReplaceOptions): string | null {
    const left = options.matchCase ? value : value.toLocaleLowerCase()
    const needle = options.matchCase ? options.find : options.find.toLocaleLowerCase()
    if (options.wholeCell) return left === needle ? options.replace : null
    if (!needle || !left.includes(needle)) return null
    if (options.matchCase) return value.split(options.find).join(options.replace)
    const pattern = new RegExp(options.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    return value.replace(pattern, () => options.replace)
}

export function buildResultReplacements(
    rows: Value[][],
    sourceRowIndexes: number[],
    visibleColumnIndexes: number[],
    selection: ResultReplaceSelection,
    options: ResultReplaceOptions,
    excludedSourceRows: Set<number> = new Set(),
): ResultReplacement[] {
    if (!options.find) return []
    const selectedRows = new Set(selection.rows)
    const selectedColumns = new Set(selection.columns)
    const replacements: ResultReplacement[] = []
    rows.forEach((row, displayedRow) => visibleColumnIndexes.forEach((sourceColumn, displayedColumn) => {
        const rowIndex = sourceRowIndexes[displayedRow]
        if (excludedSourceRows.has(rowIndex)) return
        if (options.selectionOnly && !selectedRows.has(displayedRow) && !selectedColumns.has(displayedColumn) && !selection.ranges.some(range => inRange(displayedColumn, displayedRow, range))) return
        const cell = row[sourceColumn]
        if (!cell || cell.t === 'null' || cell.ref || cell.t === 'bytes') return
        const before = displayValue(cell)
        const text = replaceText(before, options)
        if (text == null || text === before) return
        if (rowIndex >= 0) replacements.push({ rowIndex, columnIndex: sourceColumn, text, isNull: false, before })
    }))
    return replacements
}
