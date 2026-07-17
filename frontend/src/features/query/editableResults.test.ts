import { describe, expect, it } from 'vitest'
import { buildEditableResultChanges, buildResultRowChanges, resolveEditableResultTarget, validateEditableResult } from './editableResults'

const info = {
    schema: 'app', table: 'users', primaryKey: ['id'], constraints: [], foreignKeys: [], indexes: [],
    columns: [{ name: 'id', typeName: 'bigint', nullable: false, primaryKey: true, default: '' }, { name: 'email', typeName: 'text', nullable: false, primaryKey: false, default: '' }],
}

describe('resolveEditableResultTarget', () => {
    it('resolves wildcard and qualified direct projections', () => {
        expect(resolveEditableResultTarget('select * from users where active = true', 'app').target).toEqual({ schema: 'app', table: 'users', columns: null })
        expect(resolveEditableResultTarget('SELECT u.id, u.email FROM "app"."users" AS u ORDER BY u.id', 'public').target).toEqual({ schema: 'app', table: 'users', columns: ['id', 'email'] })
    })

    it('rejects results without unambiguous row ownership', () => {
        expect(resolveEditableResultTarget('select u.id from users u join teams t on t.id=u.team_id', 'app').target).toBeNull()
        expect(resolveEditableResultTarget('select count(*) from users', 'app').target).toBeNull()
        expect(resolveEditableResultTarget('select id as user_id from users', 'app').target).toBeNull()
        expect(resolveEditableResultTarget('select id from users union select id from archived_users', 'app').target).toBeNull()
    })
})

describe('validateEditableResult', () => {
    it('requires physical columns and the full primary key', () => {
        const target = { schema: 'app', table: 'users', columns: ['id', 'email'] }
        expect(validateEditableResult(target, [{ name: 'id', typeName: 'bigint' }, { name: 'email', typeName: 'text' }], info).target).toEqual(target)
        expect(validateEditableResult({ ...target, columns: ['email'] }, [{ name: 'email', typeName: 'text' }], info).reason).toContain('Primary key')
        expect(validateEditableResult(target, [{ name: 'id', typeName: 'bigint' }, { name: 'label', typeName: 'text' }], info).target).toBeNull()
    })
})

it('groups cell edits by row and preserves keys and original values', () => {
    const columns = [{ name: 'tenant_id', typeName: 'int' }, { name: 'id', typeName: 'int' }, { name: 'email', typeName: 'text' }]
    const baseRows = [[{ t: 'i64', v: 2 }, { t: 'i64', v: 7 }, { t: 'str', v: 'old@example.com' }]]
    const changes = buildResultRowChanges(columns, baseRows, ['tenant_id', 'id'], [
        { rowIndex: 0, columnIndex: 2, cell: { null: false, text: 'new@example.com' } },
        { rowIndex: 0, columnIndex: 1, cell: { null: false, text: '8' } },
    ])
    expect(changes).toHaveLength(1)
    expect(changes[0].key).toEqual({ tenant_id: { null: false, text: '2' }, id: { null: false, text: '7' } })
    expect(changes[0].set).toEqual({ email: { null: false, text: 'new@example.com' }, id: { null: false, text: '8' } })
    expect(changes[0].original.email.text).toBe('old@example.com')
})

it('builds atomic updates, inserts, and deletes while cancelling removed inserts', () => {
    const columns = [{ name: 'id', typeName: 'int' }, { name: 'name', typeName: 'text' }]
    const baseRows = [[{ t: 'i64', v: 1 }, { t: 'str', v: 'Ada' }], [{ t: 'i64', v: 2 }, { t: 'str', v: 'Grace' }]]
    const changes = buildEditableResultChanges(columns, baseRows, ['id'], [
        { rowIndex: 0, columnIndex: 1, cell: { null: false, text: 'Ada L.' } },
        { rowIndex: 2, columnIndex: 1, cell: { null: false, text: 'Linus' } },
        { rowIndex: 2, columnIndex: 0, cell: { null: true, text: '' } },
        { rowIndex: 3, columnIndex: 1, cell: { null: false, text: 'Cancelled' } },
    ], new Set([2, 3]), new Set([1, 3]))
    expect(changes.map(change => change.kind)).toEqual(['update', 'insert', 'delete'])
    expect(changes[1].set).toEqual({ name: { null: false, text: 'Linus' }, id: { null: true, text: '' } })
    expect(changes[2].key).toEqual({ id: { null: false, text: '2' } })
    expect(changes[2].rowIndex).toBe(1)
    expect(changes[2].original.name.text).toBe('Grace')
})
