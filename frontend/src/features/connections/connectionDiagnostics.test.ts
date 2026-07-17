import { describe, expect, it } from 'vitest'
import { api } from '../../../wailsjs/go/models'
import { diagnosticReport, latencySummary } from './connectionDiagnostics'

describe('connection diagnostics', () => {
    it('calculates latency range, average, and jitter', () => {
        expect(latencySummary([1, 2, 3])).toEqual({ min: 1, average: 2, max: 3, jitter: Math.sqrt(2 / 3) })
    })
    it('creates a credential-free copyable report', () => {
        const result = api.ConnectionDiagnostics.createFrom({ engine: 'postgres', host: 'db.local', port: 5432, database: 'app', user: 'reader', serverVersion: 'PostgreSQL 17', latenciesMs: [2, 4], tlsActive: true, tlsDetail: 'SSL', sshActive: false, sshHost: '', checkedAt: '2026-07-13T00:00:00Z' })
        const report = diagnosticReport('Production', result)
        expect(report).toContain('Latency: 3.00 ms average')
        expect(report).toContain('TLS: Active')
        expect(report).not.toContain('password')
    })
})
