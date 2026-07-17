import { describe, expect, it } from 'vitest'
import { benchmarkFingerprint, compareBenchmark, loadBenchmarkBaselines, saveBenchmarkBaselines } from './benchmarkBaselines'
import { BenchmarkStats } from './queryBenchmark'

const stats = (average: number, p95: number): BenchmarkStats => ({ min: average, max: p95, average, median: average, p95, standardDeviation: 0 })

describe('benchmark baselines', () => {
    it('normalizes equivalent SQL for baseline matching', () => {
        expect(benchmarkFingerprint(' SELECT  *\nFROM users; ')).toBe('select * from users')
    })
    it('classifies regression and improvement from average and p95', () => {
        expect(compareBenchmark(stats(10, 12), stats(12, 15)).status).toBe('regressed')
        expect(compareBenchmark(stats(10, 12), stats(8, 9)).status).toBe('improved')
        expect(compareBenchmark(stats(10, 12), stats(10.5, 12.5)).status).toBe('stable')
    })
    it('round-trips valid baselines through storage', () => {
        const values = new Map<string, string>()
        const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } } as Storage
        const baseline = { id: 'b1', name: 'Before index', engine: 'postgres', connId: 'c1', statement: 'select 1', fingerprint: 'select 1', parameters: {}, rows: 1, runs: 10, createdAt: 1, stats: stats(2, 3) }
        saveBenchmarkBaselines([baseline], storage)
        expect(loadBenchmarkBaselines(storage)).toEqual([baseline])
    })
})
