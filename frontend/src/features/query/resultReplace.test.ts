import { describe, expect, it } from 'vitest'
import { buildResultReplacements } from './resultReplace'

const rows = [
    [{ t: 'i64', v: 1 }, { t: 'str', v: 'Ada Lovelace' }],
    [{ t: 'i64', v: 2 }, { t: 'str', v: 'ADA Byron' }],
    [{ t: 'i64', v: 3 }, { t: 'null' }],
]

describe('result find and replace', () => {
    it('replaces case-insensitive matches in loaded visible cells', () => {
        const result = buildResultReplacements(rows, [4, 2, 9], [1, 0], { ranges: [], rows: [], columns: [] }, {
            find: 'ada', replace: 'Grace', matchCase: false, wholeCell: false, selectionOnly: false,
        })
        expect(result).toEqual([
            { rowIndex: 4, columnIndex: 1, before: 'Ada Lovelace', text: 'Grace Lovelace', isNull: false },
            { rowIndex: 2, columnIndex: 1, before: 'ADA Byron', text: 'Grace Byron', isNull: false },
        ])
    })

    it('restricts replacements to selected displayed coordinates', () => {
        const result = buildResultReplacements(rows, [0, 1, 2], [0, 1], { ranges: [{ x: 1, y: 1, width: 1, height: 1 }], rows: [], columns: [] }, {
            find: 'ADA Byron', replace: 'Grace', matchCase: true, wholeCell: true, selectionOnly: true,
        })
        expect(result).toMatchObject([{ rowIndex: 1, columnIndex: 1, text: 'Grace' }])
    })

    it('skips NULL, truncated, and binary cells', () => {
        const unsafe = [[{ t: 'str', v: 'match', ref: 'large' }, { t: 'bytes', v: 'match' }, { t: 'null' }]]
        expect(buildResultReplacements(unsafe, [0], [0, 1, 2], { ranges: [], rows: [], columns: [] }, { find: 'match', replace: 'x', matchCase: true, wholeCell: false, selectionOnly: false })).toEqual([])
        expect(buildResultReplacements(rows, [0, 1, 2], [1], { ranges: [], rows: [], columns: [] }, { find: 'Ada', replace: 'x', matchCase: false, wholeCell: false, selectionOnly: false }, new Set([0, 1]))).toEqual([])
    })
})
