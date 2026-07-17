import type { Column, Value } from '../../ipc/types'
import { ResultSnapshot } from './resultComparison'

const STORAGE_KEY = 'datagrid.result-snapshots.v1'
const MAX_SNAPSHOTS = 30
const MAX_STORAGE_CHARS = 4_000_000
const MAX_ROWS_PER_SNAPSHOT = 10_000

export interface PersistentResultSnapshot extends ResultSnapshot {
    connId: string
    statement: string
    createdAt: number
    sourceRowCount: number
    truncated: boolean
}

function validColumns(value: unknown): value is Column[] {
    return Array.isArray(value) && value.every(column => column && typeof column === 'object' && typeof column.name === 'string' && typeof column.typeName === 'string')
}

function validRows(value: unknown): value is Value[][] {
    return Array.isArray(value) && value.every(row => Array.isArray(row) && row.every(cell => cell && typeof cell === 'object' && typeof cell.t === 'string'))
}

function valid(item: unknown): item is PersistentResultSnapshot {
    if (!item || typeof item !== 'object') return false
    const value = item as Partial<PersistentResultSnapshot>
    return typeof value.id === 'string' && typeof value.label === 'string' && typeof value.connId === 'string' &&
        typeof value.statement === 'string' && typeof value.createdAt === 'number' && typeof value.sourceRowCount === 'number' &&
        typeof value.truncated === 'boolean' && validColumns(value.columns) && validRows(value.rows)
}

function loadAll(storage: Storage): PersistentResultSnapshot[] {
    try {
        const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]') as unknown
        return Array.isArray(value) ? value.filter(valid).sort((left, right) => right.createdAt - left.createdAt) : []
    } catch { return [] }
}

function persist(snapshots: PersistentResultSnapshot[], storage: Storage) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(snapshots)) } catch { /* optional local artifact */ }
}

export function loadResultSnapshots(storage: Storage = window.localStorage): PersistentResultSnapshot[] {
    return loadAll(storage)
}

export function saveResultSnapshot(input: Omit<PersistentResultSnapshot, 'id' | 'createdAt' | 'sourceRowCount'> & { sourceRowCount?: number; createdAt?: number }, storage: Storage = window.localStorage): PersistentResultSnapshot {
    if (!input.label.trim()) throw new Error('Snapshot name is required')
    const createdAt = input.createdAt ?? Date.now()
    const sourceRowCount = input.sourceRowCount ?? input.rows.length
    let snapshot: PersistentResultSnapshot = {
        ...input,
        label: input.label.trim(),
        id: `result-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt,
        sourceRowCount,
        rows: input.rows.slice(0, MAX_ROWS_PER_SNAPSHOT),
        truncated: input.truncated || input.rows.length > MAX_ROWS_PER_SNAPSHOT,
    }
    const snapshots = [snapshot, ...loadAll(storage)].slice(0, MAX_SNAPSHOTS)
    while (JSON.stringify(snapshots).length > MAX_STORAGE_CHARS && snapshots.length > 1) snapshots.pop()
    while (JSON.stringify(snapshots).length > MAX_STORAGE_CHARS && snapshot.rows.length > 0) {
        snapshot = { ...snapshot, rows: snapshot.rows.slice(0, Math.floor(snapshot.rows.length / 2)), truncated: true }
        snapshots[0] = snapshot
    }
    persist(snapshots, storage)
    return snapshot
}

export function deleteResultSnapshot(id: string, storage: Storage = window.localStorage) {
    persist(loadAll(storage).filter(snapshot => snapshot.id !== id), storage)
}
