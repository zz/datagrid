import { describe, expect, it } from 'vitest'
import type { Column } from '../../ipc/types'
import { buildServerFacetStatement, buildServerFilterWhere, buildServerResultCountStatement, buildServerResultStatement, canBuildServerResultView, RESULT_VIEW_MARKER } from './serverResultView'

const columns: Column[] = [{ name: 'id', typeName: 'integer' }, { name: 'status', typeName: 'text' }]

describe('server result view', () => {
    it('builds NULL-aware filters and sorting with quoted identifiers', () => {
        const sql = buildServerResultStatement('SELECT id, status FROM orders;', columns, {
            filters: [{ column: 1, op: 'in', value: '', values: ['open', "owner's"], includeNull: true }],
            search: '', sort: { column: 0, descending: true }, sorts: [{ column: 0, descending: true }, { column: 1, descending: false }],
        }, 'postgres')
        expect(sql).toContain(RESULT_VIEW_MARKER)
        expect(sql).toContain(`("status" IN ('open', 'owner''s') OR "status" IS NULL)`)
        expect(sql).toContain('ORDER BY "id" DESC, "status" ASC')
    })

    it('uses MySQL text casts and escapes LIKE patterns', () => {
        const sql = buildServerResultStatement('SELECT id, status FROM orders', columns, {
            filters: [{ column: 1, op: 'contains', value: '50%_off' }], search: '', sort: null,
        }, 'mysql')
        expect(sql).toContain('LOWER(CAST(`status` AS CHAR))')
        expect(sql).toContain(`LIKE '%50\\%\\_off%'`)
    })

    it('keeps numeric-looking values quoted so text identifiers retain their meaning', () => {
        const sql = buildServerResultStatement('SELECT id, status FROM orders', columns, {
            filters: [{ column: 1, op: '=', value: '0012' }], search: '', sort: null,
        }, 'postgres')
        expect(sql).toContain(`"status" = '0012'`)
    })

    it('returns the base query for an empty view and rejects ambiguous labels', () => {
        expect(buildServerResultStatement('SELECT id FROM orders;', columns, { filters: [], search: '', sort: null }, 'postgres')).toBe('SELECT id FROM orders')
        expect(canBuildServerResultView([{ name: 'id', typeName: '' }, { name: 'ID', typeName: '' }])).toBe(false)
    })

    it('builds a facet that excludes its own filter and keeps other rules', () => {
        const sql = buildServerFacetStatement('SELECT id, status FROM orders', columns, {
            filters: [{ column: 0, op: '>', value: '10' }, { column: 1, op: '=', value: 'open' }],
            expression: { conjunction: 'and', groups: [{ id: 'advanced', conjunction: 'and', filters: [{ column: 0, op: '<', value: '50' }, { column: 1, op: '!=', value: 'closed' }] }] },
            search: '', sort: { column: 0, descending: true },
        }, 1, 'postgres', 'pen%', 501)
        expect(sql).toContain(`"id" > '10'`)
        expect(sql).toContain(`"id" < '50'`)
        expect(sql).not.toContain(`"status" = 'open'`)
        expect(sql).not.toContain(`"status" <> 'closed'`)
        expect(sql).toContain(`LOWER(CAST("status" AS TEXT)) LIKE '%pen\\%%'`)
        expect(sql).toContain('GROUP BY "status"')
        expect(sql).toContain('LIMIT 501')
    })

    it('falls back for unsupported grouped value types', () => {
        expect(buildServerFacetStatement('SELECT payload FROM events', [{ name: 'payload', typeName: 'json' }], { filters: [], search: '', sort: null }, 0, 'postgres')).toBeNull()
    })

    it('generates grouped expression SQL using the selected conjunctions', () => {
        const where = buildServerFilterWhere(columns, [], {
            conjunction: 'or',
            groups: [
                { id: 'status', conjunction: 'or', filters: [{ column: 1, op: '=', value: 'open' }, { column: 1, op: 'is null', value: '' }] },
                { id: 'id', conjunction: 'and', filters: [{ column: 0, op: '>', value: '10' }, { column: 0, op: '<', value: '20' }] },
            ],
        }, 'postgres')
        expect(where).toBe(`WHERE (("status" = 'open' OR "status" IS NULL) OR ("id" > '10' AND "id" < '20'))`)
    })

    it('wraps the exact active statement for matching row counts', () => {
        expect(buildServerResultCountStatement(' SELECT * FROM orders WHERE status = \'open\'; ')).toBe("SELECT COUNT(*) AS datagrid_count FROM (SELECT * FROM orders WHERE status = 'open') AS datagrid_count_source")
        expect(buildServerResultCountStatement(' ; ')).toBeNull()
    })
})
