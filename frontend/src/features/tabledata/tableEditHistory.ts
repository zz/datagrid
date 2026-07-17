import type { Value } from '../../ipc/types'

export interface PendingTableEdit {
    kind: 'update' | 'insert' | 'delete'
    key: Record<string, string>
    set: Record<string, { null: boolean; text: string }>
    rowIndex: number
}

export interface TableEditSnapshot {
    rows: Value[][]
    edits: PendingTableEdit[]
}

export function pushEditSnapshot(stack: TableEditSnapshot[], rows: Value[][], edits: PendingTableEdit[], limit = 100): TableEditSnapshot[] {
    return [...stack, { rows, edits }].slice(-limit)
}

export function stepEditHistory(rows: Value[][], edits: PendingTableEdit[], from: TableEditSnapshot[], to: TableEditSnapshot[]) {
    const target = from.at(-1)
    if (!target) return null
    return {
        rows: target.rows,
        edits: target.edits,
        from: from.slice(0, -1),
        to: pushEditSnapshot(to, rows, edits),
    }
}

export function revertPendingChange(rows: Value[][], baseRows: Value[][], columns: string[], edits: PendingTableEdit[], editIndex: number, column?: string) {
    const edit = edits[editIndex]
    if (!edit) return { rows, edits }
    const nextRows = [...rows]
    const nextEdits = [...edits]
    if (edit.kind === 'delete') {
        nextEdits.splice(editIndex, 1)
        if (Object.keys(edit.set).length) nextEdits.splice(editIndex, 0, { ...edit, kind: 'update' })
        return { rows: nextRows, edits: nextEdits }
    }
    if (edit.kind === 'insert' && !column) {
        nextRows.splice(edit.rowIndex, 1)
        nextEdits.splice(editIndex, 1)
        return { rows: nextRows, edits: nextEdits.map(item => item.rowIndex > edit.rowIndex ? { ...item, rowIndex: item.rowIndex - 1 } : item) }
    }

    const names = column ? [column] : Object.keys(edit.set)
    const nextSet = { ...edit.set }
    const row = [...(nextRows[edit.rowIndex] ?? [])]
    for (const name of names) {
        delete nextSet[name]
        const columnIndex = columns.indexOf(name)
        if (columnIndex < 0) continue
        row[columnIndex] = edit.kind === 'insert' ? { t: 'null' } : baseRows[edit.rowIndex]?.[columnIndex] ?? { t: 'null' }
    }
    nextRows[edit.rowIndex] = row
    if (edit.kind === 'update' && Object.keys(nextSet).length === 0) nextEdits.splice(editIndex, 1)
    else nextEdits[editIndex] = { ...edit, set: nextSet }
    return { rows: nextRows, edits: nextEdits }
}
