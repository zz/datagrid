import type { Column, Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'

export interface ResultForeignKey {
    name: string
    columns: string[]
    referencedSchema: string
    referencedTable: string
    referencedColumns: string[]
}

export function foreignKeyForColumn(keys: ResultForeignKey[], column: string): ResultForeignKey | undefined {
    return keys.find(key => key.columns.includes(column))
}

export function foreignKeyLookupEdits(key: ResultForeignKey, resultColumns: Column[], referenceColumns: Column[], referenceRow: Value[], rowIndex: number) {
    return key.columns.flatMap((column, index) => {
        const columnIndex = resultColumns.findIndex(item => item.name === column)
        const referenceIndex = referenceColumns.findIndex(item => item.name === key.referencedColumns[index])
        const value = referenceRow[referenceIndex]
        if (columnIndex < 0 || referenceIndex < 0 || !value) return []
        return [{
            rowIndex,
            columnIndex,
            text: value.t === 'null' ? '' : displayValue(value),
            isNull: value.t === 'null',
        }]
    })
}
