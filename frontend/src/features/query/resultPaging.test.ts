import { describe, expect, it } from 'vitest'
import { resultPageRange, resultPagination } from './resultPaging'

describe('result paging', () => {
    it('clamps requested pages and computes offsets', () => {
        expect(resultPagination(950, 8, 200)).toEqual({ page: 4, pageSize: 200, pageCount: 5, offset: 800 })
        expect(resultPagination(0, 4, 0)).toEqual({ page: 0, pageSize: 1, pageCount: 1, offset: 0 })
    })

    it('reports loaded row ranges and handles empty pages', () => {
        expect(resultPageRange(2, 200, 75)).toEqual({ start: 401, end: 475 })
        expect(resultPageRange(0, 200, 0)).toBeNull()
    })
})
