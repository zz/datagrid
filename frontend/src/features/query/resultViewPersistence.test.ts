import { describe, expect, it } from 'vitest'
import { loadResultViewState, normalizeResultViewState, resultViewStorageKey, saveResultViewState } from './resultViewPersistence'

function memoryStorage(): Storage {
    const values = new Map<string, string>()
    return { length: 0, clear: () => values.clear(), getItem: key => values.get(key) ?? null, key: () => null, removeItem: key => values.delete(key), setItem: (key, value) => values.set(key, value) }
}

describe('result view persistence', () => {
    it('persists a complete view state', () => {
        const storage = memoryStorage()
        const key = resultViewStorageKey('console-1', [{ name: 'id', typeName: 'integer' }, { name: 'name', typeName: 'text' }])
        const view = {
            filters: [{ column: 1, op: 'in', value: '', values: ['Ada', 'Lin'], includeNull: true }],
            expression: { conjunction: 'and' as const, groups: [{ id: 'g1', conjunction: 'or' as const, filters: [{ column: 0, op: '>', value: '10' }] }] },
            search: 'active',
            sort: { column: 1, descending: true },
            sorts: [{ column: 1, descending: true }, { column: 0, descending: false }],
            analysisLimit: 500,
        }
        saveResultViewState(key, view, storage)
        expect(loadResultViewState(key, 2, storage)).toEqual(view)
    })

    it('drops malformed and out-of-range column state', () => expect(normalizeResultViewState({
        filters: [{ column: 0, op: '=', value: 'ok' }, { column: 4, op: '=', value: 'stale' }, null],
        expression: { conjunction: 'or', groups: [{ id: 'g1', conjunction: 'and', filters: [{ column: 3, op: '=', value: 'stale' }] }] },
        search: 42,
        sort: { column: 5, descending: true },
        analysisLimit: 1_000_000,
    }, 2)).toEqual({ filters: [{ column: 0, op: '=', value: 'ok' }], expression: null, search: '', sort: null, sorts: [], analysisLimit: null }))

    it('migrates a legacy single-column sort into the ordered stack', () => expect(normalizeResultViewState({
        filters: [], search: '', sort: { column: 1, descending: true },
    }, 2)).toEqual({ filters: [], expression: null, search: '', sort: { column: 1, descending: true }, sorts: [{ column: 1, descending: true }], analysisLimit: null }))

    it('isolates state by console and ordered result schema', () => {
        const users = [{ name: 'id', typeName: 'integer' }]
        expect(resultViewStorageKey('console-1', users)).not.toBe(resultViewStorageKey('console-2', users))
        expect(resultViewStorageKey('console-1', users)).not.toBe(resultViewStorageKey('console-1', [{ name: 'id', typeName: 'text' }]))
    })

    it('returns an empty view for invalid JSON', () => {
        const storage = memoryStorage()
        storage.setItem('view', '{')
        expect(loadResultViewState('view', 3, storage)).toEqual({ filters: [], expression: null, search: '', sort: null, sorts: [], analysisLimit: null })
    })
})
