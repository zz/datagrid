import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { compareMetadata } from './comparison'
import { generateMetadataMigration } from './metadataMigration'

const info = (overrides: Partial<drivers.TableInfo>) => drivers.TableInfo.createFrom({ schema: 'public', table: 'users', columns: [], primaryKey: [], constraints: [], foreignKeys: [], indexes: [], ...overrides })

describe('metadata comparison and migration', () => {
    it('compares constraints and standalone indexes', () => {
        const origin = info({ constraints: [{ name: 'users_pkey', kind: 'primary_key', columns: ['id'], definition: 'PRIMARY KEY (id)' }], indexes: [{ name: 'users_email_idx', columns: ['email'], unique: false }] })
        const target = info({ indexes: [{ name: 'legacy_idx', columns: ['legacy'], unique: false }] })
        expect(compareMetadata(origin, target).map(item => `${item.status}:${item.category}:${item.name}`)).toEqual(['added:constraint:users_pkey', 'added:index:users_email_idx', 'removed:index:legacy_idx'])
    })

    it('orders PostgreSQL drops before additions', () => {
        const origin = info({ indexes: [{ name: 'users_email_idx', columns: ['email'], unique: true }] })
        const target = info({ indexes: [{ name: 'users_email_idx', columns: ['email'], unique: false }] })
        const migration = generateMetadataMigration('postgres', origin, target)
        expect(migration.before).toContain('DROP INDEX "public"."users_email_idx";')
        expect(migration.after).toContain('CREATE UNIQUE INDEX "users_email_idx"')
    })

    it('detects a changed foreign-key target', () => {
        const constraint = { name: 'orders_user_fk', kind: 'foreign_key', columns: ['user_id'], definition: 'FOREIGN KEY' }
        const key = { name: 'orders_user_fk', columns: ['user_id'], referencedSchema: 'public', referencedColumns: ['id'], onUpdate: 'NO ACTION', onDelete: 'CASCADE' }
        const origin = info({ constraints: [constraint], foreignKeys: [{ ...key, referencedTable: 'users' }] })
        const target = info({ constraints: [constraint], foreignKeys: [{ ...key, referencedTable: 'legacy_users' }] })
        expect(compareMetadata(origin, target)).toMatchObject([{ category: 'constraint', status: 'changed', name: 'orders_user_fk' }])
    })
})
