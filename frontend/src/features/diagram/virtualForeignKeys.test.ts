import { describe, expect, it } from 'vitest'
import { deleteVirtualForeignKey, loadVirtualForeignKeys, saveVirtualForeignKey } from './virtualForeignKeys'

function memoryStorage(): Storage {
    const values = new Map<string, string>()
    return { length: 0, clear: () => values.clear(), getItem: key => values.get(key) ?? null, key: () => null, removeItem: key => values.delete(key), setItem: (key, value) => values.set(key, value) }
}

describe('virtual foreign keys', () => {
    it('persists relationships per connection', () => {
        const storage = memoryStorage()
        const key = saveVirtualForeignKey({ connId: 'pg', name: 'orders_customer', source: 'public.orders', target: 'public.customers', sourceColumns: ['customer_id'], targetColumns: ['id'] }, storage)
        saveVirtualForeignKey({ connId: 'mysql', name: 'other', source: 'shop.a', target: 'shop.b', sourceColumns: ['b_id'], targetColumns: ['id'] }, storage)
        expect(loadVirtualForeignKeys('pg', storage)).toEqual([key])
        deleteVirtualForeignKey(key.id, storage)
        expect(loadVirtualForeignKeys('pg', storage)).toEqual([])
        expect(loadVirtualForeignKeys('mysql', storage)).toHaveLength(1)
    })

    it('rejects incomplete mappings and duplicate names', () => {
        const storage = memoryStorage()
        const input = { connId: 'pg', name: 'virtual_fk', source: 'public.a', target: 'public.b', sourceColumns: ['b_id'], targetColumns: ['id'] }
        saveVirtualForeignKey(input, storage)
        expect(() => saveVirtualForeignKey(input, storage)).toThrow(/already exists/)
        expect(() => saveVirtualForeignKey({ ...input, name: 'bad', targetColumns: [] }, storage)).toThrow(/Every source column/)
    })
})
