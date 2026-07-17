import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { diagramEdges, layoutTables } from './diagramModel'
import { VirtualForeignKey } from './virtualForeignKeys'

const table = (schema: string, name: string, foreignKeys: drivers.ForeignKeyInfo[] = []) => drivers.TableInfo.createFrom({
    schema, table: name, columns: [], primaryKey: [], constraints: [], foreignKeys, indexes: [],
})

describe('ER diagram model', () => {
    it('lays tables out in stable rows', () => {
        expect(layoutTables(['a', 'b', 'c'], 2)).toEqual({
            a: { x: 36, y: 36 }, b: { x: 346, y: 36 }, c: { x: 36, y: 336 },
        })
    })

    it('only emits relationships whose endpoints are loaded', () => {
        const fk = drivers.ForeignKeyInfo.createFrom({ name: 'orders_user', columns: ['user_id'], referencedSchema: 'public', referencedTable: 'users', referencedColumns: ['id'] })
        const tables = { 'public.orders': table('public', 'orders', [fk]), 'public.users': table('public', 'users') }
        expect(diagramEdges(tables)).toMatchObject([{ source: 'public.orders', target: 'public.users', label: 'user_id -> id' }])
        expect(diagramEdges({ 'public.orders': tables['public.orders'] })).toEqual([])
    })

    it('renders virtual relationships only when both tables are present', () => {
        const tables = { 'public.orders': table('public', 'orders'), 'public.users': table('public', 'users') }
        const virtual: VirtualForeignKey = { id: 'v1', connId: 'pg', name: 'orders_user', source: 'public.orders', target: 'public.users', sourceColumns: ['user_id'], targetColumns: ['id'], createdAt: 1 }
        expect(diagramEdges(tables, [virtual])).toMatchObject([{ source: 'public.orders', target: 'public.users', virtual: true }])
        expect(diagramEdges({ 'public.orders': tables['public.orders'] }, [virtual])).toEqual([])
    })
})
