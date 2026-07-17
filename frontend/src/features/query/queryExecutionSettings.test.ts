import { describe, expect, it } from 'vitest'
import { isPageableResultStatement, loadQueryExecutionSettings, normalizeExecutionSettings, saveQueryExecutionSettings } from './queryExecutionSettings'

function memoryStorage(): Storage {
    const values = new Map<string, string>()
    return { length: 0, clear: () => values.clear(), getItem: key => values.get(key) ?? null, key: () => null, removeItem: key => values.delete(key), setItem: (key, value) => values.set(key, value) }
}

describe('query execution settings', () => {
    it('persists settings per console', () => {
        const storage = memoryStorage()
        saveQueryExecutionSettings('q1', { timeoutSeconds: 30, rowLimit: 500, confirmDestructive: false }, storage)
        expect(loadQueryExecutionSettings('q1', storage)).toEqual({ timeoutSeconds: 30, rowLimit: 500, confirmDestructive: false })
        expect(loadQueryExecutionSettings('q2', storage)).toEqual({ timeoutSeconds: 0, rowLimit: 0, confirmDestructive: true })
    })

    it('rounds and clamps unsafe numeric values', () => {
        expect(normalizeExecutionSettings({ timeoutSeconds: 9999, rowLimit: -4, confirmDestructive: true })).toEqual({ timeoutSeconds: 3600, rowLimit: 0, confirmDestructive: true })
        expect(normalizeExecutionSettings({ timeoutSeconds: 2.6, rowLimit: 2_000_000 })).toEqual({ timeoutSeconds: 3, rowLimit: 1_000_000, confirmDestructive: true })
    })

    it('only offers paging for a single SELECT-shaped result', () => {
        expect(isPageableResultStatement('SELECT * FROM users')).toBe(true)
        expect(isPageableResultStatement('( select 1 )')).toBe(true)
        expect(isPageableResultStatement('WITH users AS (SELECT 1) SELECT * FROM users')).toBe(false)
        expect(isPageableResultStatement('SHOW TABLES')).toBe(false)
    })
})
