import { describe, expect, it } from 'vitest'
import { deleteResultSnapshot, loadResultSnapshots, saveResultSnapshot } from './resultSnapshots'

function memoryStorage(): Storage {
    const values = new Map<string, string>()
    return { length: 0, clear: () => values.clear(), getItem: key => values.get(key) ?? null, key: () => null, removeItem: key => values.delete(key), setItem: (key, value) => values.set(key, value) }
}

const input = (label: string, createdAt: number) => ({ label, connId: 'pg', statement: 'select 1', columns: [{ name: 'id', typeName: 'int' }], rows: [[{ t: 'i64', v: 1 }]], truncated: false, createdAt })

describe('persistent result snapshots', () => {
    it('stores named snapshots newest first with source metadata', () => {
        const storage = memoryStorage()
        saveResultSnapshot(input('First', 10), storage)
        saveResultSnapshot(input('Second', 20), storage)
        expect(loadResultSnapshots(storage).map(snapshot => [snapshot.label, snapshot.sourceRowCount])).toEqual([['Second', 1], ['First', 1]])
    })

    it('deletes snapshots and ignores corrupt storage', () => {
        const storage = memoryStorage()
        const snapshot = saveResultSnapshot(input('Saved', 10), storage)
        deleteResultSnapshot(snapshot.id, storage)
        expect(loadResultSnapshots(storage)).toEqual([])
        storage.setItem('datagrid.result-snapshots.v1', '{bad')
        expect(loadResultSnapshots(storage)).toEqual([])
    })

    it('requires a visible snapshot name', () => {
        expect(() => saveResultSnapshot(input('   ', 10), memoryStorage())).toThrow(/name is required/)
    })

    it('retains the newest thirty snapshots', () => {
        const storage = memoryStorage()
        for (let index = 0; index < 35; index++) saveResultSnapshot(input(`Snapshot ${index}`, index), storage)
        const snapshots = loadResultSnapshots(storage)
        expect(snapshots).toHaveLength(30)
        expect(snapshots[0].label).toBe('Snapshot 34')
        expect(snapshots.at(-1)?.label).toBe('Snapshot 5')
    })
})
