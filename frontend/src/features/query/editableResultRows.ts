import type { Column, Value } from '../../ipc/types'
import { editableCellInput, ResultCellEdit } from './editableResults'

export interface EditableResultRowState {
    rows: Value[][]
    edits: Record<string, ResultCellEdit>
    insertedRows: Set<number>
    deletedRows: Set<number>
}

export function duplicateResultRows(state: EditableResultRowState, columns: Column[], primaryKey: string[], sourceRows: number[]): EditableResultRowState | null {
    const keys = new Set(primaryKey)
    const rows = [...state.rows]
    const edits = { ...state.edits }
    const insertedRows = new Set(state.insertedRows)
    let changed = false
    ;[...new Set(sourceRows)].forEach(sourceRow => {
        const source = state.rows[sourceRow]
        if (!source || state.deletedRows.has(sourceRow)) return
        const rowIndex = rows.length
        const row = source.map(cell => ({ ...cell }))
        columns.forEach((column, columnIndex) => {
            if (keys.has(column.name)) { row[columnIndex] = { t: 'null' }; return }
            edits[`${rowIndex}:${columnIndex}`] = { rowIndex, columnIndex, cell: editableCellInput(row[columnIndex]) }
        })
        rows.push(row); insertedRows.add(rowIndex); changed = true
    })
    return changed ? { rows, edits, insertedRows, deletedRows: state.deletedRows } : null
}

export function setResultRowsDeleted(state: EditableResultRowState, sourceRows: number[], deleted: boolean): EditableResultRowState | null {
    const selected = [...new Set(sourceRows)].filter(index => index >= 0 && index < state.rows.length)
    if (!selected.length) return null
    if (!deleted) {
        const deletedRows = new Set(state.deletedRows)
        let changed = false
        selected.forEach(index => { if (deletedRows.delete(index)) changed = true })
        return changed ? { ...state, deletedRows } : null
    }
    const removed = selected.filter(index => state.insertedRows.has(index)).sort((left, right) => left - right)
    const removedSet = new Set(removed)
    const deletedBeforeRemap = new Set(state.deletedRows)
    selected.forEach(index => { if (!state.insertedRows.has(index)) deletedBeforeRemap.add(index) })
    if (!removed.length && selected.every(index => state.deletedRows.has(index))) return null
    const remapIndex = (index: number) => index - removed.filter(removedIndex => removedIndex < index).length
    const edits: Record<string, ResultCellEdit> = {}
    Object.values(state.edits).forEach(edit => {
        if (removedSet.has(edit.rowIndex)) return
        const rowIndex = remapIndex(edit.rowIndex)
        edits[`${rowIndex}:${edit.columnIndex}`] = { ...edit, rowIndex }
    })
    const remapSet = (values: Set<number>) => new Set([...values].filter(index => !removedSet.has(index)).map(remapIndex))
    return {
        rows: state.rows.filter((_, index) => !removedSet.has(index)),
        edits,
        insertedRows: remapSet(state.insertedRows),
        deletedRows: remapSet(deletedBeforeRemap),
    }
}
