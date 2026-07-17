import { describe, expect, it } from 'vitest'
import { pushResultSnapshot, resultSnapshot, stepResultHistory } from './editableResultHistory'

const baseRows = [[{ t: 'i64', v: 1 }]]
const changedRows = [[{ t: 'i64', v: 2 }], [{ t: 'null' }]]

describe('editable result history', () => {
    it('restores cell, insert, and delete state as one snapshot', () => {
        const base = resultSnapshot(baseRows, {}, new Set(), new Set())
        const current = resultSnapshot(changedRows, { '0:0': { rowIndex: 0, columnIndex: 0, cell: { null: false, text: '2' } } }, new Set([1]), new Set([0]))
        const undone = stepResultHistory(current, pushResultSnapshot([], base), [])!
        expect(undone.target).toEqual(base)
        const redone = stepResultHistory(undone.target, undone.to, undone.from)!
        expect(redone.target).toEqual(current)
    })

    it('caps retained snapshots', () => {
        let stack = [] as ReturnType<typeof resultSnapshot>[]
        for (let index = 0; index < 5; index++) stack = pushResultSnapshot(stack, resultSnapshot([[{ t: 'i64', v: index }]], {}, new Set(), new Set()), 3)
        expect(stack).toHaveLength(3)
        expect(stack[0].rows[0][0].v).toBe(2)
    })
})
