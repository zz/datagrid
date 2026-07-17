import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { deferredTransferCells, missingRequiredColumns, suggestedTransferMapping, transferCellText, transferRows } from './dataTransfer'

describe('cross-source data transfer', () => {
    it('maps columns case-insensitively and reports required gaps', () => {
        const target = [drivers.ColumnInfo.createFrom({ name: 'ID', typeName: 'int', nullable: false, default: '' }), drivers.ColumnInfo.createFrom({ name: 'created', typeName: 'date', nullable: false, default: 'now()' })]
        const mapping = suggestedTransferMapping([{ name: 'id', typeName: 'int' }], target)
        expect(mapping).toEqual({ ID: 'id', created: '' })
        expect(missingRequiredColumns(target, mapping)).toEqual([])
    })
    it('converts mapped JSON and null values', () => {
        const rows = transferRows([{ name: 'payload', typeName: 'json' }, { name: 'note', typeName: 'text' }], [[{ t: 'json', v: { ok: true } }, { t: 'null' }]], { data: 'payload', comment: 'note' })
        expect(rows).toEqual([{ data: { null: false, text: '{"ok":true}' }, comment: { null: true, text: '' } }])
    })
    it('preserves raw byte payloads and identifies deferred cells', () => {
        expect(transferCellText({ t: 'bytes', v: 'YWJj' })).toEqual({ null: false, text: 'YWJj' })
        expect(deferredTransferCells([[{ t: 'ref', v: 'cell-1' }], [{ t: 'str', v: 'ready' }]])).toBe(1)
    })
})
