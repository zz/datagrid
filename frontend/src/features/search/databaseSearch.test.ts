import { describe, expect, it } from 'vitest'
import { definitionMatch, metadataMatches, SearchObject } from './databaseSearch'

const objects: SearchObject[] = [{ connId: 'c1', connName: 'Local', schema: 'public', kind: 'table', name: 'orders', columns: ['id', 'customer_email'] }]

describe('database search', () => {
    it('matches qualified objects and columns case-insensitively', () => {
        expect(metadataMatches(objects, 'ORDERS').map(match => match.source)).toEqual(['object'])
        expect(metadataMatches(objects, 'EMAIL')[0].detail).toBe('public.orders.customer_email')
    })
    it('returns a compact definition context', () => {
        const match = definitionMatch(objects[0], 'customer_id', 'CREATE VIEW recent AS SELECT customer_id, created_at FROM public.orders WHERE active = true')
        expect(match?.source).toBe('definition')
        expect(match?.detail).toContain('customer_id')
    })
})
