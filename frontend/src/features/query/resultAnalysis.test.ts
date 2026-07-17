import { describe, expect, it } from 'vitest'
import { buildChartData, numericColumnIndexes } from './resultAnalysis'

const columns = [{ name: 'month', typeName: 'text' }, { name: 'total', typeName: 'numeric' }]
const rows = [[{ t: 'str', v: 'Jan' }, { t: 'f64', v: 12.5 }], [{ t: 'str', v: 'Feb' }, { t: 'null' }]]

describe('result analysis', () => {
    it('finds columns with numeric result values', () => expect(numericColumnIndexes(columns, rows)).toEqual([1]))
    it('builds finite chart points and skips nulls', () => expect(buildChartData(rows, 0, 1)).toEqual([{ label: 'Jan', value: 12.5 }]))
    it('uses a display formatter for chart labels', () => expect(buildChartData(rows, 0, 1, 100, value => `[${value.v}]`)[0].label).toBe('[Jan]'))
})
