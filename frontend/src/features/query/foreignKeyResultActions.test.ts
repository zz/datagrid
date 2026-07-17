import { describe, expect, it } from 'vitest'
import { foreignKeyForColumn, foreignKeyLookupEdits, ResultForeignKey } from './foreignKeyResultActions'

const key: ResultForeignKey = {
    name: 'order_tenant_customer', columns: ['tenant_id', 'customer_id'],
    referencedSchema: 'app', referencedTable: 'customers', referencedColumns: ['tenant_id', 'id'],
}

describe('foreign-key result actions', () => {
    it('finds the relationship for a selected result column', () => {
        expect(foreignKeyForColumn([key], 'customer_id')).toBe(key)
        expect(foreignKeyForColumn([key], 'description')).toBeUndefined()
    })

    it('maps a referenced row to every visible local key column', () => {
        expect(foreignKeyLookupEdits(
            key,
            [{ name: 'customer_id', typeName: 'bigint' }, { name: 'tenant_id', typeName: 'bigint' }],
            [{ name: 'id', typeName: 'bigint' }, { name: 'name', typeName: 'text' }, { name: 'tenant_id', typeName: 'bigint' }],
            [{ t: 'i64', v: 42 }, { t: 'str', v: 'Ada' }, { t: 'i64', v: 7 }],
            3,
        )).toEqual([
            { rowIndex: 3, columnIndex: 1, text: '7', isNull: false },
            { rowIndex: 3, columnIndex: 0, text: '42', isNull: false },
        ])
    })
})
