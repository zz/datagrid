import type { Column, Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'

export interface ResultSnapshot { id: string; label: string; columns: Column[]; rows: Value[][]; connId?: string; statement?: string; createdAt?: number; sourceRowCount?: number; truncated?: boolean }
export interface ComparedRow { key: string; status: 'added' | 'removed' | 'changed' | 'equal'; differences: string[] }

export function commonColumnNames(left: ResultSnapshot, right: ResultSnapshot): string[] {
    const rightNames = new Set(right.columns.map(column => column.name))
    return left.columns.map(column => column.name).filter(name => rightNames.has(name))
}

export function compareResultRows(baseline: ResultSnapshot, current: ResultSnapshot, keyColumn = ''): ComparedRow[] {
    const common = commonColumnNames(baseline, current)
    const leftIndexes = new Map(baseline.columns.map((column, index) => [column.name, index]))
    const rightIndexes = new Map(current.columns.map((column, index) => [column.name, index]))
    const keyed = (snapshot: ResultSnapshot, indexes: Map<string, number>) => {
        const occurrences = new Map<string, number>()
        return new Map(snapshot.rows.map((row, rowIndex) => {
            const raw = keyColumn ? displayValue(row[indexes.get(keyColumn) ?? -1] ?? { t: 'null' }) : String(rowIndex + 1)
            const occurrence = occurrences.get(raw) ?? 0
            occurrences.set(raw, occurrence + 1)
            return [`${raw}\0${occurrence}`, { row, label: occurrence ? `${raw} (${occurrence + 1})` : raw }] as const
        }))
    }
    const left = keyed(baseline, leftIndexes)
    const right = keyed(current, rightIndexes)
    return [...new Set([...left.keys(), ...right.keys()])].map(key => {
        const before = left.get(key)
        const after = right.get(key)
        if (!before) return { key: after!.label, status: 'added' as const, differences: ['Row added'] }
        if (!after) return { key: before.label, status: 'removed' as const, differences: ['Row removed'] }
        const differences = common.flatMap(name => {
            const oldValue = displayValue(before.row[leftIndexes.get(name)!] ?? { t: 'null' })
            const newValue = displayValue(after.row[rightIndexes.get(name)!] ?? { t: 'null' })
            return oldValue === newValue ? [] : [`${name}: ${oldValue} -> ${newValue}`]
        })
        return { key: after.label, status: differences.length ? 'changed' as const : 'equal' as const, differences }
    })
}
