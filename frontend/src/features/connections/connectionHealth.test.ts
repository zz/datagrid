import { describe, expect, it } from 'vitest'
import { failedHealth, healthLabel, latencyQuality, successfulHealth } from './connectionHealth'

describe('connection health', () => {
    it('classifies measured latency', () => {
        expect(latencyQuality(12)).toBe('healthy')
        expect(latencyQuality(120)).toBe('degraded')
        expect(latencyQuality(250)).toBe('slow')
    })
    it('tracks failures and resets them after recovery', () => {
        const first = failedHealth(undefined, 'timeout', 'now')
        const second = failedHealth(first, 'timeout', 'later')
        expect(second.consecutiveFailures).toBe(2)
        expect(healthLabel(second)).toContain('2 failed checks')
        expect(successfulHealth(second, 20, 'recovered').consecutiveFailures).toBe(0)
    })
})
