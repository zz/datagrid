import type { Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'

export type PivotAggregate = 'count' | 'sum' | 'average' | 'min' | 'max'
export interface PivotResult { columns: string[]; rows: Array<{ label: string; values: Array<number | null>; total: number | null }> }

export function buildPivot(rows: Value[][], rowIndex: number, columnIndex: number | null, valueIndex: number, aggregate: PivotAggregate): PivotResult {
    const columnLabels = columnIndex == null ? ['Value'] : [...new Set(rows.map(row => displayValue(row[columnIndex] ?? { t: 'null' })))].sort()
    const rowLabels = [...new Set(rows.map(row => displayValue(row[rowIndex] ?? { t: 'null' })))].sort()
    const buckets = new Map<string, number[]>()
    rows.forEach(row => {
        const rowLabel = displayValue(row[rowIndex] ?? { t: 'null' })
        const columnLabel = columnIndex == null ? 'Value' : displayValue(row[columnIndex] ?? { t: 'null' })
        const value = Number(row[valueIndex]?.v)
        const bucket = `${rowLabel}\0${columnLabel}`
        if (!buckets.has(bucket)) buckets.set(bucket, [])
        if (aggregate === 'count' || Number.isFinite(value)) buckets.get(bucket)!.push(aggregate === 'count' ? 1 : value)
    })
    const reduce = (values: number[]): number | null => {
        if (!values.length) return null
        if (aggregate === 'count') return values.length
        if (aggregate === 'sum') return values.reduce((total, value) => total + value, 0)
        if (aggregate === 'average') return values.reduce((total, value) => total + value, 0) / values.length
        return aggregate === 'min' ? Math.min(...values) : Math.max(...values)
    }
    return {
        columns: columnLabels,
        rows: rowLabels.map(label => {
            const values = columnLabels.map(column => reduce(buckets.get(`${label}\0${column}`) ?? []))
            const source = rows.filter(row => displayValue(row[rowIndex] ?? { t: 'null' }) === label)
            const totals = source.flatMap(row => {
                const value = Number(row[valueIndex]?.v)
                return aggregate === 'count' ? [1] : Number.isFinite(value) ? [value] : []
            })
            return { label, values, total: reduce(totals) }
        }),
    }
}
