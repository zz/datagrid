import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { generateDropTable, generateMissingTableMigration } from './schemaSync'

describe('schema table synchronization', () => {
    it('creates columns before constraints and maps local foreign-key schemas', () => {
        const origin = drivers.TableInfo.createFrom({
            schema: 'source', table: 'orders', primaryKey: ['id'], indexes: [],
            columns: [{ name: 'id', typeName: 'bigint', nullable: false, default: '' }, { name: 'user_id', typeName: 'bigint', nullable: false, default: '' }],
            constraints: [{ name: 'orders_user_fk', kind: 'foreign_key', columns: ['user_id'], definition: 'FOREIGN KEY' }],
            foreignKeys: [{ name: 'orders_user_fk', columns: ['user_id'], referencedSchema: 'source', referencedTable: 'users', referencedColumns: ['id'], onUpdate: 'NO ACTION', onDelete: 'CASCADE' }],
        })
        const migration = generateMissingTableMigration('mysql', origin, 'target')
        expect(migration.create).toContain('CREATE TABLE `target`.`orders`')
        expect(migration.constraints).toContain('REFERENCES `target`.`users`')
    })
    it('uses a non-cascading quoted drop', () => expect(generateDropTable('postgres', 'public', 'old')).toBe('DROP TABLE "public"."old";'))
})
