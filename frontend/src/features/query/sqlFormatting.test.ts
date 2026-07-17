import { describe, expect, it } from 'vitest'
import { formatSQLEdit, formatSQL } from './sqlFormatting'

describe('SQL formatting', () => {
    it('formats PostgreSQL keywords and keeps dialect syntax', () => {
        const result = formatSQL('select id,name from users where payload::jsonb is not null', 'postgres')
        expect(result).toContain('SELECT')
        expect(result).toContain('payload::jsonb')
    })
    it('formats only the selected range and selects the replacement', () => {
        const source = 'select 1; select id,name from users; select 3;'
        const from = source.indexOf('select id')
        const to = source.indexOf('; select 3')
        const edit = formatSQLEdit(source, from, to, 'mysql')!
        expect(edit.from).toBe(from)
        expect(edit.to).toBe(to)
        expect(edit.insert).toMatch(/SELECT\s+id,\s+name\s+FROM\s+users/)
        expect(edit.selectionFrom).toBe(from)
        expect(edit.selectionTo).toBe(from + edit.insert.length)
    })
    it('returns no edit for whitespace-only input', () => {
        expect(formatSQLEdit('   ', 0, 0, 'postgres')).toBeNull()
    })
})
