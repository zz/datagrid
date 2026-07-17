import { describe, expect, it } from 'vitest'
import { inspectSQL, resolveTableReference } from './sqlDiagnostics'

const schema = { 'public.users': ['id', 'email'], 'public.orders': ['id', 'user_id'] }

describe('SQL diagnostics', () => {
    it('reports unknown tables and qualified columns', () => {
        expect(inspectSQL('SELECT u.missing FROM users u JOIN absent a ON a.id = u.id', schema).map(item => item.message)).toEqual([
            'Unknown table public.absent', 'Unknown column u.missing',
        ])
    })
    it('suggests unique close identifier matches', () => {
        const diagnostics = inspectSQL('SELECT u.emali FROM usres u', schema)
        expect(diagnostics.map(item => item.replacement)).toEqual(['users'])
        expect(inspectSQL('SELECT u.emali FROM users u', schema)[0].replacement).toBe('email')
    })
    it('warns for destructive statements without a where clause', () => {
        expect(inspectSQL('UPDATE users SET email = null', schema)).toMatchObject([{ severity: 'warning', message: 'UPDATE has no WHERE clause and may affect every row', insertWhereAt: 29 }])
        expect(inspectSQL('DELETE FROM users WHERE id = 1', schema)).toEqual([])
    })
    it('ignores table-like text in strings and comments', () => {
        expect(inspectSQL("SELECT 'FROM absent UPDATE users'; -- JOIN missing DELETE\nSELECT u.id FROM users u", schema)).toEqual([])
    })
    it('resolves qualified, default-schema, and unique table references', () => {
        expect(resolveTableReference('public.users', schema)).toBe('public.users')
        expect(resolveTableReference('users', schema)).toBe('public.users')
        expect(resolveTableReference('events', { 'audit.events': [] })).toBe('audit.events')
    })
})
