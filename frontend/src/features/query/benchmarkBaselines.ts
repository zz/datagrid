import { BenchmarkStats } from './queryBenchmark'

export interface BenchmarkBaseline {
    id: string
    name: string
    engine: string
    connId: string
    statement: string
    fingerprint: string
    parameters: Record<string, string>
    rows: number
    runs: number
    createdAt: number
    stats: BenchmarkStats
}

export interface BenchmarkRegression {
    averagePercent: number
    p95Percent: number
    status: 'improved' | 'stable' | 'regressed'
}

const STORAGE_KEY = 'datagrid.benchmark-baselines.v1'

export function benchmarkFingerprint(statement: string): string {
    return statement.trim().replace(/;+$/, '').replace(/\s+/g, ' ').toLowerCase()
}

export function compareBenchmark(baseline: BenchmarkStats, current: BenchmarkStats, threshold = 10): BenchmarkRegression {
    const percent = (before: number, after: number) => before === 0 ? 0 : (after - before) / before * 100
    const averagePercent = percent(baseline.average, current.average)
    const p95Percent = percent(baseline.p95, current.p95)
    const worst = Math.max(averagePercent, p95Percent)
    const best = Math.min(averagePercent, p95Percent)
    return { averagePercent, p95Percent, status: worst > threshold ? 'regressed' : best < -threshold ? 'improved' : 'stable' }
}

export function loadBenchmarkBaselines(storage: Storage = localStorage): BenchmarkBaseline[] {
    try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.fingerprint === 'string' && item.stats && typeof item.stats.average === 'number') : []
    } catch { return [] }
}

export function saveBenchmarkBaselines(items: BenchmarkBaseline[], storage: Storage = localStorage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(items))
}
