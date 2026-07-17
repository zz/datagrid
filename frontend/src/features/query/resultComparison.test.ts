import { describe, expect, it } from 'vitest'
import { compareResultRows, ResultSnapshot } from './resultComparison'

const snapshot = (id: string, rows: Array<Array<{ t: string; v: unknown }>>): ResultSnapshot => ({
    id, label: id, columns: [{ name: 'id', typeName: 'int' }, { name: 'name', typeName: 'text' }], rows,
})

describe('result comparison', () => {
    it('matches by a selected key and classifies changes', () => {
        const before = snapshot('before', [[{ t: 'i64', v: 1 }, { t: 'str', v: 'old' }], [{ t: 'i64', v: 2 }, { t: 'str', v: 'gone' }]])
        const after = snapshot('after', [[{ t: 'i64', v: 1 }, { t: 'str', v: 'new' }], [{ t: 'i64', v: 3 }, { t: 'str', v: 'added' }]])
        expect(compareResultRows(before, after, 'id').map(row => row.status)).toEqual(['changed', 'removed', 'added'])
        expect(compareResultRows(before, after, 'id')[0].differences).toEqual(['name: old -> new'])
    })
})
