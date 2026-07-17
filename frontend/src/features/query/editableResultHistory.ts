import type { Value } from '../../ipc/types'
import type { ResultCellEdit } from './editableResults'

export interface EditableResultSnapshot {
    rows: Value[][]
    edits: Record<string, ResultCellEdit>
    insertedRows: number[]
    deletedRows: number[]
}

export function resultSnapshot(rows: Value[][], edits: Record<string, ResultCellEdit>, insertedRows: Set<number>, deletedRows: Set<number>): EditableResultSnapshot {
    return { rows, edits, insertedRows: [...insertedRows], deletedRows: [...deletedRows] }
}

export function pushResultSnapshot(stack: EditableResultSnapshot[], snapshot: EditableResultSnapshot, limit = 100): EditableResultSnapshot[] {
    return [...stack, snapshot].slice(-limit)
}

export function stepResultHistory(current: EditableResultSnapshot, from: EditableResultSnapshot[], to: EditableResultSnapshot[]) {
    const target = from.at(-1)
    if (!target) return null
    return {
        target,
        from: from.slice(0, -1),
        to: pushResultSnapshot(to, current),
    }
}
