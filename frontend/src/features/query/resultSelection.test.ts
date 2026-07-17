import { describe, expect, it } from 'vitest'
import { selectedResultRowIndexes, selectResultRange, selectionStatistics } from './resultSelection'

describe('result selection', () => {
    it('extracts a displayed range through reordered source columns', () => {
        const selected = selectResultRange(
            [{ name: 'id', typeName: 'int' }, { name: 'name', typeName: 'text' }, { name: 'score', typeName: 'float' }],
            [[{ t: 'i64', v: 1 }, { t: 'str', v: 'Ada' }, { t: 'f64', v: 9.5 }], [{ t: 'i64', v: 2 }, { t: 'str', v: 'Lin' }, { t: 'null' }]],
            [2, 0],
            { x: 0, y: 0, width: 2, height: 2 },
        )
        expect(selected?.columns.map(column => column.name)).toEqual(['score', 'id'])
        expect(selected?.rows[1]).toEqual([{ t: 'null' }, { t: 'i64', v: 2 }])
        expect(selected?.cellCount).toBe(4)
    })

    it('calculates statistics across all selected cells', () => {
        expect(selectionStatistics([[{ t: 'i64', v: 2 }, { t: 'null' }], [{ t: 'f64', v: 3.5 }, { t: 'i64', v: 2 }]])).toEqual({
            count: 3, nulls: 1, distinct: 2, numericCount: 3, sum: 7.5, min: 2, max: 3.5,
        })
    })

    it('unions row markers and stacked cell ranges', () => {
        expect(selectedResultRowIndexes([4, 1], [{ x: 0, y: 2, width: 2, height: 3 }, { x: 1, y: 7, width: 1, height: 1 }])).toEqual([1, 2, 3, 4, 7])
    })
})
