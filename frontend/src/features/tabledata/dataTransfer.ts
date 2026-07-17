import type { Column, Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'
import { drivers } from '../../../wailsjs/go/models'

export function suggestedTransferMapping(source: Column[], target: drivers.ColumnInfo[]): Record<string, string> {
    const sourceByLower = new Map(source.map(column => [column.name.toLowerCase(), column.name]))
    return Object.fromEntries(target.map(column => [column.name, sourceByLower.get(column.name.toLowerCase()) ?? '']))
}

export function transferCellText(value?: Value): { null: boolean; text: string } {
    if (!value || value.t === 'null') return { null: true, text: '' }
    if (value.t === 'json' && typeof value.v !== 'string') return { null: false, text: JSON.stringify(value.v) }
    if (value.t === 'bytes') return { null: false, text: String(value.v ?? '') }
    return { null: false, text: displayValue(value) }
}

export function deferredTransferCells(rows: Value[][]): number {
    return rows.reduce((count, row) => count + row.filter(value => value?.t === 'ref').length, 0)
}

export function transferRows(sourceColumns: Column[], rows: Value[][], mapping: Record<string, string>): Array<Record<string, { null: boolean; text: string }>> {
    const indexes = new Map(sourceColumns.map((column, index) => [column.name, index]))
    return rows.map(row => Object.fromEntries(Object.entries(mapping).flatMap(([target, source]) => {
        const index = indexes.get(source)
        return source && index != null ? [[target, transferCellText(row[index])] as const] : []
    })))
}

export function missingRequiredColumns(target: drivers.ColumnInfo[], mapping: Record<string, string>): string[] {
    return target.filter(column => !column.nullable && !column.default.trim() && !mapping[column.name]).map(column => column.name)
}
