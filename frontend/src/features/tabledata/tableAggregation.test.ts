import { describe, expect, it } from 'vitest'
import type { Value } from '../../ipc/types'
import { selectionAggregation } from './TableDataTab'

describe('table selection aggregation', () => {
    it('uses visible-to-source column indexes', () => {
        const rows: Value[][] = [
            [{ t: 'i64', v: 100 }, { t: 'i64', v: 2 }, { t: 'str', v: 'a' }],
            [{ t: 'i64', v: 200 }, { t: 'i64', v: 4 }, { t: 'str', v: 'b' }],
        ]
        const result = selectionAggregation({ x: 0, y: 0, width: 1, height: 2 }, rows, [1, 2])
        expect(result).toMatchObject({ count: 2, numericCount: 2, sum: 6, min: 2, max: 4 })
    })

    it('counts non-null text without treating it as numeric', () => {
        const rows: Value[][] = [[{ t: 'str', v: '12' }], [{ t: 'null' }]]
        expect(selectionAggregation({ x: 0, y: 0, width: 1, height: 2 }, rows, [0])).toMatchObject({
            count: 1,
            numericCount: 0,
        })
    })
})
