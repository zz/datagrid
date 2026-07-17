import { describe, expect, it } from 'vitest'
import { loadConsoleSnapshot, saveConsoleSnapshot } from './consolePersistence'

function memoryStorage(): Storage {
    const values = new Map<string, string>()
    return {
        length: 0,
        clear: () => values.clear(),
        getItem: key => values.get(key) ?? null,
        key: () => null,
        removeItem: key => values.delete(key),
        setItem: (key, value) => values.set(key, value),
    }
}

describe('console persistence', () => {
    it('round-trips console text without transient result state', () => {
        const storage = memoryStorage()
        const snapshot = {
            consoles: [{ id: 'q1', connId: 'pg', title: 'Report', sql: 'select 1' }],
            activeConsoleId: 'q1',
        }
        saveConsoleSnapshot(snapshot, storage)
        expect(loadConsoleSnapshot(storage)).toEqual(snapshot)
    })

    it('recovers from corrupt storage', () => {
        const storage = memoryStorage()
        storage.setItem('datagrid.consoles.v1', '{broken')
        expect(loadConsoleSnapshot(storage)).toEqual({ consoles: [], activeConsoleId: null })
    })
})
