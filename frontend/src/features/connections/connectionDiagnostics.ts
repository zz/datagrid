import { api } from '../../../wailsjs/go/models'

export interface LatencySummary { min: number; average: number; max: number; jitter: number }

export function latencySummary(samples: number[]): LatencySummary | null {
    if (!samples.length) return null
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length
    const variance = samples.reduce((sum, value) => sum + (value - average) ** 2, 0) / samples.length
    return { min: Math.min(...samples), average, max: Math.max(...samples), jitter: Math.sqrt(variance) }
}

export function diagnosticReport(connectionName: string, result: api.ConnectionDiagnostics): string {
    const latency = latencySummary(result.latenciesMs)
    return [
        `Data source: ${connectionName}`, `Engine: ${result.engine}`, `Endpoint: ${result.host}:${result.port}`,
        `Database: ${result.database}`, `User: ${result.user}`, `Server: ${result.serverVersion || 'Unavailable'}`,
        `Latency: ${latency ? `${latency.average.toFixed(2)} ms average (${latency.min.toFixed(2)}-${latency.max.toFixed(2)} ms)` : 'Unavailable'}`,
        `TLS: ${result.tlsActive ? `Active (${result.tlsDetail})` : `Inactive (${result.tlsDetail})`}`,
        `SSH: ${result.sshActive ? `Active (${result.sshHost})` : 'Inactive'}`, `Checked: ${result.checkedAt}`,
    ].join('\n')
}
