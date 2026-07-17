import { describe, expect, it } from 'vitest'
import { expandWildcards, qualifySelectColumns } from './sqlIntentions'

const schema = { 'public.users': ['id', 'email'], 'public.orders': ['id', 'user_id'] }

describe('SQL intentions', () => {
    it('expands a bare wildcard for one source', () => {
        expect(expandWildcards('SELECT * FROM users u', schema)).toBe('SELECT u.id, u.email FROM users u')
    })
    it('expands qualified wildcards across joins', () => {
        expect(expandWildcards('SELECT u.*, o.* FROM users u JOIN orders o ON o.user_id = u.id', schema))
            .toBe('SELECT u.id, u.email, o.id, o.user_id FROM users u JOIN orders o ON o.user_id = u.id')
    })
    it('qualifies only simple columns with one source', () => {
        expect(qualifySelectColumns('SELECT id, email AS address, count(*) FROM users u', schema))
            .toBe('SELECT u.id, u.email AS address, count(*) FROM users u')
        expect(qualifySelectColumns('SELECT id FROM users u JOIN orders o ON true', schema)).toBe('SELECT id FROM users u JOIN orders o ON true')
    })
})
