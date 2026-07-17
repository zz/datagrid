import { describe, expect, it } from 'vitest'
import { duplicateResultRows, setResultRowsDeleted } from './editableResultRows'

const columns = [{ name: 'id', typeName: 'int' }, { name: 'name', typeName: 'text' }, { name: 'note', typeName: 'text' }]

describe('editable result row operations', () => {
    it('duplicates non-key fields and preserves explicit NULL', () => {
        const result = duplicateResultRows({
            rows: [[{ t: 'i64', v: 7 }, { t: 'str', v: 'Ada' }, { t: 'null' }]], edits: {}, insertedRows: new Set(), deletedRows: new Set(),
        }, columns, ['id'], [0])!
        expect(result.rows[1]).toEqual([{ t: 'null' }, { t: 'str', v: 'Ada' }, { t: 'null' }])
        expect(result.edits['1:1'].cell).toEqual({ null: false, text: 'Ada' })
        expect(result.edits['1:2'].cell).toEqual({ null: true, text: '' })
    })

    it('removes selected inserts and remaps later edit indexes atomically', () => {
        const result = setResultRowsDeleted({
            rows: [[{ t: 'i64', v: 1 }], [{ t: 'null' }], [{ t: 'null' }]],
            edits: { '1:0': { rowIndex: 1, columnIndex: 0, cell: { null: false, text: '2' } }, '2:0': { rowIndex: 2, columnIndex: 0, cell: { null: false, text: '3' } } },
            insertedRows: new Set([1, 2]), deletedRows: new Set(),
        }, [0, 1], true)!
        expect(result.rows).toHaveLength(2)
        expect([...result.insertedRows]).toEqual([1])
        expect(result.deletedRows).toEqual(new Set([0]))
        expect(result.edits['1:0'].cell.text).toBe('3')
    })

    it('restores existing deletion markers', () => {
        const state = { rows: [[{ t: 'i64', v: 1 }]], edits: {}, insertedRows: new Set<number>(), deletedRows: new Set([0]) }
        expect(setResultRowsDeleted(state, [0], false)?.deletedRows.size).toBe(0)
    })
})
