import { describe, expect, it } from 'vitest'
import { clearConsoleRevisions, deleteConsoleRevision, diffLines, loadConsoleRevisions, saveConsoleRevision } from './consoleLocalHistory'

function memoryStorage(): Storage {
    const values = new Map<string, string>()
    return { length: 0, clear: () => values.clear(), getItem: key => values.get(key) ?? null, key: () => null, removeItem: key => values.delete(key), setItem: (key, value) => values.set(key, value) }
}

describe('console local history', () => {
    it('stores newest revisions first and deduplicates unchanged SQL', () => {
        const storage = memoryStorage()
        saveConsoleRevision({ tabId: 'q1', title: 'Console', sql: 'select 1', reason: 'edit', createdAt: 10 }, storage)
        saveConsoleRevision({ tabId: 'q1', title: 'Console', sql: 'select 1', reason: 'executed', createdAt: 20 }, storage)
        saveConsoleRevision({ tabId: 'q1', title: 'Console', sql: 'select 2', reason: 'edit', createdAt: 30 }, storage)
        expect(loadConsoleRevisions('q1', storage).map(item => [item.sql, item.reason])).toEqual([['select 2', 'edit'], ['select 1', 'executed']])
    })

    it('deletes one revision or clears one console without touching another', () => {
        const storage = memoryStorage()
        const first = saveConsoleRevision({ tabId: 'q1', title: 'One', sql: 'one', reason: 'edit', createdAt: 10 }, storage)
        saveConsoleRevision({ tabId: 'q1', title: 'One', sql: 'two', reason: 'edit', createdAt: 20 }, storage)
        saveConsoleRevision({ tabId: 'q2', title: 'Two', sql: 'other', reason: 'edit', createdAt: 30 }, storage)
        deleteConsoleRevision(first.id, storage)
        expect(loadConsoleRevisions('q1', storage)).toHaveLength(1)
        clearConsoleRevisions('q1', storage)
        expect(loadConsoleRevisions('q1', storage)).toEqual([])
        expect(loadConsoleRevisions('q2', storage)).toHaveLength(1)
    })

    it('creates a stable line-level diff', () => {
        expect(diffLines('select id\nfrom users', 'select id, name\nfrom users\nwhere active')).toEqual([
            { kind: 'removed', text: 'select id', oldLine: 1 },
            { kind: 'added', text: 'select id, name', newLine: 1 },
            { kind: 'same', text: 'from users', oldLine: 2, newLine: 2 },
            { kind: 'added', text: 'where active', newLine: 3 },
        ])
    })
})
