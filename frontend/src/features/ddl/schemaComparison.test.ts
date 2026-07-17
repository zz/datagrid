import { describe, expect, it } from 'vitest'
import { classifySchemaTables, schemaTables } from './schemaComparison'

describe('schema comparison', () => {
    it('extracts table names for one schema', () => {
        expect(schemaTables({ 'public.users': [], 'public.orders': [], 'audit.events': [] }, 'public')).toEqual(['orders', 'users'])
    })
    it('classifies presence on each side', () => {
        expect(classifySchemaTables(['orders', 'users'], ['legacy', 'users'])).toEqual([
            { name: 'legacy', status: 'extra-target' }, { name: 'orders', status: 'missing-target' }, { name: 'users', status: 'match' },
        ])
    })
})
