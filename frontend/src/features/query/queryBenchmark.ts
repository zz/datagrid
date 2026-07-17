export interface BenchmarkStats {
    min: number
    max: number
    average: number
    median: number
    p95: number
    standardDeviation: number
}

export function benchmarkStats(durations: number[]): BenchmarkStats | null {
    if (!durations.length) return null
    const sorted = [...durations].sort((a, b) => a - b)
    const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    const variance = sorted.reduce((sum, value) => sum + (value - average) ** 2, 0) / sorted.length
    return { min: sorted[0], max: sorted.at(-1)!, average, median, p95: sorted[Math.ceil(sorted.length * .95) - 1], standardDeviation: Math.sqrt(variance) }
}

export function formatBenchmarkMs(value: number): string {
    return value < 1 ? `${value.toFixed(3)} ms` : `${value.toFixed(2)} ms`
}
