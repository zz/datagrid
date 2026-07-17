export type HealthQuality = 'healthy' | 'degraded' | 'slow' | 'offline'

export interface ConnectionHealthState {
    quality: HealthQuality
    latencyMs: number
    checkedAt: string
    consecutiveFailures: number
    error?: string
}

export function latencyQuality(latencyMs: number): Exclude<HealthQuality, 'offline'> {
    if (latencyMs < 50) return 'healthy'
    if (latencyMs < 200) return 'degraded'
    return 'slow'
}

export function successfulHealth(previous: ConnectionHealthState | undefined, latencyMs: number, checkedAt: string): ConnectionHealthState {
    return { quality: latencyQuality(latencyMs), latencyMs, checkedAt, consecutiveFailures: 0 }
}

export function failedHealth(previous: ConnectionHealthState | undefined, error: string, checkedAt = new Date().toISOString()): ConnectionHealthState {
    return { quality: 'offline', latencyMs: previous?.latencyMs ?? 0, checkedAt, consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1, error }
}

export function healthLabel(state?: ConnectionHealthState): string {
    if (!state) return 'Health check pending'
    if (state.quality === 'offline') return `Unreachable (${state.consecutiveFailures} failed ${state.consecutiveFailures === 1 ? 'check' : 'checks'})`
    return `${state.quality[0].toUpperCase() + state.quality.slice(1)} / ${state.latencyMs.toFixed(1)} ms`
}
