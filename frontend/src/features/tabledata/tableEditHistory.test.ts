import { describe, expect, it } from 'vitest'
import { pushEditSnapshot, revertPendingChange, stepEditHistory } from './tableEditHistory'

const base = [[{ t: 'i64', v: 1 }, { t: 'str', v: 'old' }]]
const update = { kind: 'update' as const, key: { id: '1' }, set: { name: { null: false, text: 'new' } }, rowIndex: 0 }

describe('table edit history', () => {
    it('steps backward while building a redo stack', () => {
        const changed = [[{ t: 'i64', v: 1 }, { t: 'str', v: 'new' }]]
        const undo = pushEditSnapshot([], base, [])
        const result = stepEditHistory(changed, [update], undo, [])!
        expect(result.rows).toEqual(base)
        expect(result.edits).toEqual([])
        expect(result.to).toEqual([{ rows: changed, edits: [update] }])
    })

    it('selectively reverts one updated column', () => {
        const changed = [[{ t: 'i64', v: 2 }, { t: 'str', v: 'new' }]]
        const edit = { ...update, set: { id: { null: false, text: '2' }, name: { null: false, text: 'new' } } }
        const result = revertPendingChange(changed, base, ['id', 'name'], [edit], 0, 'name')
        expect(result.rows[0][1]).toEqual({ t: 'str', v: 'old' })
        expect(result.edits[0].set).toEqual({ id: { null: false, text: '2' } })
    })

    it('removes inserted rows and adjusts later edit indexes', () => {
        const rows = [...base, [{ t: 'null' }], [{ t: 'null' }]]
        const edits = [{ kind: 'insert' as const, key: {}, set: {}, rowIndex: 1 }, { kind: 'insert' as const, key: {}, set: {}, rowIndex: 2 }]
        const result = revertPendingChange(rows, base, ['id'], edits, 0)
        expect(result.rows).toHaveLength(2)
        expect(result.edits[0].rowIndex).toBe(1)
    })

    it('restores an update retained behind a staged delete', () => {
        const deleted = { ...update, kind: 'delete' as const }
        const result = revertPendingChange([[{ t: 'i64', v: 1 }, { t: 'str', v: 'new' }]], base, ['id', 'name'], [deleted], 0)
        expect(result.edits).toEqual([update])
    })
})
