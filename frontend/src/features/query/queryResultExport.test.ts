import { describe, expect, it } from 'vitest'
import { queryResultExportData } from './queryResultExport'

const columns = [{ name: 'id', typeName: 'int' }, { name: 'name', typeName: 'text' }, { name: 'score', typeName: 'float' }]
const rows = [
    [{ t: 'i64', v: 1 }, { t: 'str', v: 'Ada' }, { t: 'f64', v: 9.5 }],
    [{ t: 'i64', v: 2 }, { t: 'str', v: 'Grace' }, { t: 'f64', v: 8 }],
]

describe('query result export scope', () => {
    it('projects visible rows through the current column layout', () => {
        const data = queryResultExportData('visible', columns, [rows[0], rows[1]], [rows[1]], [2, 0])!
        expect(data.columns.map(column => column.name)).toEqual(['score', 'id'])
        expect(data.rows).toEqual([[{ t: 'f64', v: 8 }, { t: 'i64', v: 2 }]])
    })

    it('extracts the active selected rectangle', () => {
        const data = queryResultExportData('selection', columns, rows, rows, [2, 0], { x: 0, y: 0, width: 1, height: 2 })!
        expect(data.columns.map(column => column.name)).toEqual(['score'])
        expect(data.rows).toHaveLength(2)
    })

    it('keeps every loaded row and source column for complete export', () => {
        expect(queryResultExportData('loaded', columns, rows, [], [2], undefined)).toEqual({ columns, rows })
    })
})
