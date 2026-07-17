import { describe, expect, it } from 'vitest'
import { formatResultCell, loadResultColumnFormats, normalizeResultColumnFormat, normalizeResultColumnFormats, resultColumnFormattingKey, saveResultColumnFormats } from './resultColumnFormatting'

const storage = () => {
    const values = new Map<string, string>()
    return {
        values,
        adapter: {
            get length() { return values.size }, clear: () => values.clear(), getItem: (key: string) => values.get(key) ?? null,
            key: (index: number) => [...values.keys()][index] ?? null, removeItem: (key: string) => { values.delete(key) }, setItem: (key: string, value: string) => { values.set(key, value) },
        } satisfies Storage,
    }
}

describe('result column formatting', () => {
    it('formats numbers without changing the source value', () => {
        const value = { t: 'f64', v: 1234.567 }
        expect(formatResultCell(value, { name: 'total', typeName: 'numeric' }, { number: 'fixed', decimals: 1 })).toBe('1234.6')
        expect(value.v).toBe(1234.567)
    })

    it('formats booleans, nulls, ISO dates, and long text', () => {
        expect(formatResultCell({ t: 'bool', v: true }, { name: 'active', typeName: 'boolean' }, { boolean: 'yes-no' })).toBe('Yes')
        expect(formatResultCell({ t: 'null' }, { name: 'note', typeName: 'text' }, { nullText: '(null)' })).toBe('(null)')
        expect(formatResultCell({ t: 'str', v: '2025-01-02T03:04:05Z' }, { name: 'created', typeName: 'timestamp' }, { date: 'iso' })).toBe('2025-01-02T03:04:05.000Z')
        expect(formatResultCell({ t: 'str', v: 'abcdefghijkl' }, { name: 'note', typeName: 'text' }, { maxLength: 8 })).toBe('abcdefg\u2026')
    })

    it('validates persisted options and schema column IDs', () => {
        expect(normalizeResultColumnFormat({ number: 'bad' as 'fixed', decimals: 99, maxLength: 2, nullText: 'x'.repeat(50) })).toEqual({ decimals: 10, nullText: 'x'.repeat(40), maxLength: 8 })
        expect(normalizeResultColumnFormats({ 'id#0': { number: 'fixed' }, stale: { date: 'iso' } }, ['id#0'])).toEqual({ 'id#0': { number: 'fixed' } })
    })

    it('persists formats under a schema-scoped key and tolerates invalid data', () => {
        const { values, adapter } = storage()
        const key = resultColumnFormattingKey('layout')
        saveResultColumnFormats(key, { 'id#0': { number: 'fixed', decimals: 0 } }, adapter)
        expect(loadResultColumnFormats(key, ['id#0'], adapter)).toEqual({ 'id#0': { number: 'fixed', decimals: 0 } })
        values.set(key, '{bad')
        expect(loadResultColumnFormats(key, ['id#0'], adapter)).toEqual({})
    })
})
