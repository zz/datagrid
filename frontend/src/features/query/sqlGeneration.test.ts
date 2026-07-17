import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { generateTableSQL } from './sqlGeneration'

const info = drivers.TableInfo.createFrom({ schema: 'public', table: 'order-items', columns: [
    { name: 'id', typeName: 'int', nullable: false, default: '' }, { name: 'label', typeName: 'text', nullable: false, default: '' },
], primaryKey: ['id'], foreignKeys: [], constraints: [], indexes: [] })

describe('table SQL generation', () => {
    it('generates quoted PostgreSQL update and conflict statements', () => {
        expect(generateTableSQL('postgres', info, 'update', ['id', 'label'])).toContain('UPDATE "public"."order-items"')
        expect(generateTableSQL('postgres', info, 'upsert', ['id', 'label'])).toContain('ON CONFLICT ("id")')
    })
    it('generates MySQL duplicate-key syntax and named values', () => {
        const sql = generateTableSQL('mysql', info, 'upsert', ['id', 'label'])
        expect(sql).toContain('INSERT INTO `public`.`order-items`')
        expect(sql).toContain('ON DUPLICATE KEY UPDATE')
        expect(sql).toContain(':label')
    })
    it('uses a safe key parameter predicate', () => {
        expect(generateTableSQL('postgres', info, 'delete', ['id'])).toContain('"id" = :key_id')
    })
})
