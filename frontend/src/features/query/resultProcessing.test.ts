import { describe, expect, it } from 'vitest'
import { columnStatistics, distinctColumnValues, filterResultExpressionRows, filterResultRows, limitResultRows, moveResultSort, processResultRows, sortResultRows, sortResultRowsByColumns, toggleResultSort, withoutResultFilterExpressionColumn } from './resultProcessing'

const rows = [[{ t: 'str', v: 'ten' }, { t: 'i64', v: 10 }], [{ t: 'str', v: 'two' }, { t: 'i64', v: 2 }], [{ t: 'str', v: 'none' }, { t: 'null' }]]

describe('result processing', () => {
    it('sorts numeric values numerically with nulls last', () => expect(sortResultRows(rows, 1).map(row => row[0].v)).toEqual(['two', 'ten', 'none']))
    it('sorts by ordered columns and keeps ties stable', () => {
        const tied = [[{ t: 'str', v: 'a' }, { t: 'i64', v: 2 }], [{ t: 'str', v: 'b' }, { t: 'i64', v: 1 }], [{ t: 'str', v: 'a' }, { t: 'i64', v: 1 }]]
        expect(sortResultRowsByColumns(tied, [{ column: 0, descending: false }, { column: 1, descending: true }]).map(row => `${row[0].v}${row[1].v}`)).toEqual(['a2', 'a1', 'b1'])
    })
    it('cycles additive sorts and reorders priority', () => {
        const first = toggleResultSort([], 1, true)
        const second = toggleResultSort(first, 0, true)
        expect(moveResultSort(second, 0, -1).map(sort => sort.column)).toEqual([0, 1])
        expect(toggleResultSort(toggleResultSort(second, 1, true), 1, true)).toEqual([{ column: 0, descending: false }])
    })
    it('applies typed filters', () => expect(filterResultRows(rows, [{ column: 1, op: '>', value: '3' }])).toHaveLength(1))
    it('applies multi-value filters with numeric coercion and NULL membership', () => expect(filterResultRows(rows, [{ column: 1, op: 'in', value: '', values: ['2'], includeNull: true }]).map(row => row[0].v)).toEqual(['two', 'none']))
    it('evaluates grouped AND/OR expressions', () => {
        const expression = {
            conjunction: 'or' as const,
            groups: [
                { id: 'names', conjunction: 'or' as const, filters: [{ column: 0, op: '=', value: 'ten' }, { column: 0, op: '=', value: 'none' }] },
                { id: 'numbers', conjunction: 'and' as const, filters: [{ column: 1, op: '>=', value: '2' }, { column: 1, op: '<', value: '3' }] },
            ],
        }
        expect(filterResultExpressionRows(rows, expression).map(row => row[0].v)).toEqual(['ten', 'two', 'none'])
        expect(withoutResultFilterExpressionColumn(expression, 0)).toEqual({ conjunction: 'or', groups: [expression.groups[1]] })
    })
    it('computes null, distinct, and numeric statistics', () => expect(columnStatistics(rows, 1)).toEqual({ count: 2, nulls: 1, distinct: 2, numericCount: 2, sum: 12, min: 2, max: 10 }))
    it('counts and naturally sorts distinct values with NULL first', () => expect(distinctColumnValues([...rows, rows[1]], 1)).toEqual([
        { value: '', count: 1, isNull: true }, { value: '2', count: 2, isNull: false }, { value: '10', count: 1, isNull: false },
    ]))
    it('processes filters, search, and sort in one shared view pipeline', () => expect(processResultRows(rows, {
        filters: [{ column: 1, op: '>=', value: '2' }], expression: null, search: 't', sort: { column: 1, descending: true },
    }).map(row => row[0].v)).toEqual(['ten', 'two']))
    it('preserves source row identity while processing a view', () => expect(processResultRows(rows, {
        filters: [], expression: null, search: 'two', sort: null,
    })[0]).toBe(rows[1]))
    it('caps analysis rows without changing the loaded result', () => {
        const limited = limitResultRows(rows, 2)
        expect(limited).toHaveLength(2)
        expect(limited[0]).toBe(rows[0])
        expect(rows).toHaveLength(3)
        expect(limitResultRows(rows, null)).toBe(rows)
    })
})
