import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { ColumnDraft, generateColumnMigration } from './migration'

const original = [drivers.ColumnInfo.createFrom({ name: 'id', typeName: 'bigint', nullable: false, default: '' })]

describe('column migration generation', () => {
    it('generates ordered PostgreSQL alterations', () => {
        const drafts: ColumnDraft[] = [{ originalName: 'id', name: 'user_id', typeName: 'integer', nullable: true, default: '1' }]
        const sql = generateColumnMigration('postgres', 'app', 'users', original, drafts)
        expect(sql).toContain('RENAME COLUMN "id" TO "user_id"')
        expect(sql).toContain('ALTER COLUMN "user_id" TYPE integer')
        expect(sql).toContain('DROP NOT NULL')
        expect(sql).toContain('SET DEFAULT 1')
    })

    it('uses complete MySQL CHANGE definitions', () => {
        const sql = generateColumnMigration('mysql', 'app', 'users', original, [{ originalName: 'id', name: 'user_id', typeName: 'bigint', nullable: false, default: '' }])
        expect(sql).toContain('CHANGE COLUMN `id` `user_id` bigint NOT NULL')
    })
})
