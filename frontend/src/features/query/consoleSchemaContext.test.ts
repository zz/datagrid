import { describe, expect, it } from 'vitest'
import { loadConsoleSchemaContext, normalizeSchemaContext, saveConsoleSchemaContext, schemaNames } from './consoleSchemaContext'

function memoryStorage(): Storage {
    const values = new Map<string, string>()
    return { length: 0, clear: () => values.clear(), getItem: key => values.get(key) ?? null, key: () => null, removeItem: key => values.delete(key), setItem: (key, value) => values.set(key, value) }
}

describe('console schema context', () => {
    it('persists an ordered context per console', () => {
        const storage = memoryStorage()
        saveConsoleSchemaContext('q1', ['tenant', 'public'], storage)
        expect(loadConsoleSchemaContext('q1', ['public'], storage)).toEqual(['tenant', 'public'])
        expect(loadConsoleSchemaContext('q2', ['public'], storage)).toEqual(['public'])
    })

    it('deduplicates PostgreSQL paths and limits MySQL to one database', () => {
        expect(normalizeSchemaContext('postgres', [' tenant ', 'public', 'tenant', ''])).toEqual(['tenant', 'public'])
        expect(normalizeSchemaContext('mysql', ['shop', 'archive'])).toEqual(['shop'])
    })

    it('extracts sorted schemas from autocomplete metadata', () => {
        expect(schemaNames({ 'sales.orders': [], 'public.users': [], 'sales.items': [] })).toEqual(['public', 'sales'])
    })
})
