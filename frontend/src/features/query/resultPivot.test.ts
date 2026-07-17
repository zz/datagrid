import { describe, expect, it } from 'vitest'
import { buildPivot } from './resultPivot'

const rows = [
    [{ t: 'str', v: 'East' }, { t: 'str', v: 'A' }, { t: 'i64', v: 10 }],
    [{ t: 'str', v: 'East' }, { t: 'str', v: 'B' }, { t: 'i64', v: 5 }],
    [{ t: 'str', v: 'West' }, { t: 'str', v: 'A' }, { t: 'i64', v: 3 }],
]

describe('result pivot', () => {
    it('builds a grouped sum matrix with totals', () => expect(buildPivot(rows, 0, 1, 2, 'sum')).toEqual({
        columns: ['A', 'B'], rows: [{ label: 'East', values: [10, 5], total: 15 }, { label: 'West', values: [3, null], total: 3 }],
    }))
    it('counts rows without requiring numeric values', () => expect(buildPivot(rows, 0, null, 0, 'count').rows[0].total).toBe(2))
})
