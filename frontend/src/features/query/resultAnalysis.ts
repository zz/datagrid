import type { Column, Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'

export interface ChartPoint { label: string; value: number }

export function numericColumnIndexes(columns: Column[], rows: Value[][]): number[] {
    return columns.map((_, index) => index).filter(index => rows.some(row => row[index]?.t === 'i64' || row[index]?.t === 'f64'))
}

export function buildChartData(rows: Value[][], labelIndex: number, valueIndex: number, limit = 100, formatLabel: (value: Value, columnIndex: number) => string = value => displayValue(value)): ChartPoint[] {
    return rows.slice(0, limit).flatMap((row, index) => {
        const cell = row[valueIndex]
        if (!cell || !['i64', 'f64'].includes(cell.t)) return []
        const value = Number(cell.v)
        if (!Number.isFinite(value)) return []
        const labelCell = row[labelIndex]
        return [{ label: labelCell ? formatLabel(labelCell, labelIndex) : String(index + 1), value }]
    })
}
