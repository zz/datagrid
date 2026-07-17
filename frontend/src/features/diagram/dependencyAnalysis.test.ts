import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { dependencyEdges, dependencyPaths, impactLevel } from './dependencyModel'
import { VirtualForeignKey } from './virtualForeignKeys'

const fk = (name: string, referencedTable: string) => drivers.ForeignKeyInfo.createFrom({
    name,
    columns: [`${referencedTable}_id`],
    referencedSchema: 'public',
    referencedTable,
    referencedColumns: ['id'],
    onUpdate: 'NO ACTION',
    onDelete: 'CASCADE',
})

const table = (name: string, foreignKeys: drivers.ForeignKeyInfo[] = []) => drivers.TableInfo.createFrom({
    schema: 'public', table: name, columns: [], primaryKey: [], constraints: [], foreignKeys, indexes: [],
})

describe('dependency analysis', () => {
    const tables = {
        'public.users': table('users'),
        'public.orders': table('orders', [fk('orders_user', 'users')]),
        'public.items': table('items', [fk('items_order', 'orders')]),
    }
    const edges = dependencyEdges(tables)

    it('normalizes foreign keys into directed dependency edges', () => {
        expect(edges[0]).toMatchObject({ source: 'public.orders', target: 'public.users', constraint: 'orders_user' })
    })

    it('finds direct and transitive incoming impact', () => {
        expect(dependencyPaths(edges, 'public.users', 'incoming')).toMatchObject([
            { table: 'public.orders', depth: 1, path: ['public.users', 'public.orders'] },
            { table: 'public.items', depth: 2, path: ['public.users', 'public.orders', 'public.items'] },
        ])
    })

    it('walks outgoing requirements and remains cycle-safe', () => {
        const cyclic = dependencyEdges({ ...tables, 'public.users': table('users', [fk('users_item', 'items')]) })
        expect(dependencyPaths(cyclic, 'public.items', 'outgoing').map(path => path.table)).toEqual(['public.orders', 'public.users'])
    })

    it('marks direct impact as higher risk', () => {
        const paths = dependencyPaths(edges, 'public.users', 'incoming')
        expect(paths.map(impactLevel)).toEqual(['high', 'medium'])
    })

    it('merges virtual relationships into traversal', () => {
        const virtual: VirtualForeignKey = { id: 'v1', connId: 'pg', name: 'items_owner', source: 'public.items', target: 'public.users', sourceColumns: ['owner_id'], targetColumns: ['id'], createdAt: 1 }
        const merged = dependencyEdges(tables, [virtual])
        expect(merged.find(edge => edge.virtualKeyId === 'v1')).toMatchObject({ source: 'public.items', target: 'public.users' })
        expect(dependencyPaths(merged, 'public.users', 'incoming').map(path => path.table)).toContain('public.items')
    })
})
