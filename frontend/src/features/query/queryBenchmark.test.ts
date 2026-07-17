import { describe, expect, it } from 'vitest'
import { benchmarkStats, formatBenchmarkMs } from './queryBenchmark'

describe('query benchmark statistics', () => {
    it('calculates distribution statistics without mutating runs', () => {
        const runs = [5, 1, 3, 2, 4]
        expect(benchmarkStats(runs)).toEqual({ min: 1, max: 5, average: 3, median: 3, p95: 5, standardDeviation: Math.sqrt(2) })
        expect(runs).toEqual([5, 1, 3, 2, 4])
    })
    it('formats sub-millisecond measurements precisely', () => {
        expect(formatBenchmarkMs(.125)).toBe('0.125 ms')
        expect(formatBenchmarkMs(12.345)).toBe('12.35 ms')
    })
})
