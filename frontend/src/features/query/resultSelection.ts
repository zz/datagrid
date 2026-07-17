import type { Column, Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'

export interface ResultRange { x: number; y: number; width: number; height: number }

export interface SelectedResultRange {
    columns: Column[]
    rows: Value[][]
    cellCount: number
}

export interface SelectionStatistics {
    count: number
    nulls: number
    distinct: number
    numericCount: number
    sum: number
    min?: number
    max?: number
}

export function selectResultRange(columns: Column[], rows: Value[][], visibleColumnIndexes: number[], range?: ResultRange): SelectedResultRange | null {
    if (!range || range.width < 1 || range.height < 1) return null
    const indexes = visibleColumnIndexes.slice(range.x, range.x + range.width)
    const selectedRows = rows.slice(range.y, range.y + range.height).map(row => indexes.map(index => row[index] ?? { t: 'null' }))
    if (!indexes.length || !selectedRows.length) return null
    return { columns: indexes.map(index => columns[index]), rows: selectedRows, cellCount: indexes.length * selectedRows.length }
}

export function selectedResultRowIndexes(selectedRows: number[], ranges: ResultRange[]): number[] {
    const indexes = new Set(selectedRows)
    ranges.forEach(range => {
        for (let row = range.y; row < range.y + range.height; row++) indexes.add(row)
    })
    return [...indexes].filter(index => index >= 0).sort((left, right) => left - right)
}

export function selectionStatistics(rows: Value[][]): SelectionStatistics {
    const values = rows.flat()
    const present = values.filter(value => value && value.t !== 'null')
    const numbers = present.flatMap(value => ['i64', 'f64'].includes(value.t) && Number.isFinite(Number(value.v)) ? [Number(value.v)] : [])
    return {
        count: present.length,
        nulls: values.length - present.length,
        distinct: new Set(present.map(displayValue)).size,
        numericCount: numbers.length,
        sum: numbers.reduce((total, value) => total + value, 0),
        min: numbers.length ? Math.min(...numbers) : undefined,
        max: numbers.length ? Math.max(...numbers) : undefined,
    }
}
