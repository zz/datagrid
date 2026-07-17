import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { comparePlans, metricDelta, planMetrics } from './planComparison'

const plan = (child: string, detail = 'cost=0.1..12.5  rows=20  actual time=1.25 ms  actual rows=18') => drivers.PlanNode.createFrom({ label: 'Root', detail, children: [{ label: child, detail: 'rows=5' }] })

describe('plan comparison', () => {
    it('extracts root metrics and node count', () => {
        expect(planMetrics(plan('Index Scan'))).toEqual({ nodes: 2, totalCost: 12.5, actualTime: 1.25, estimatedRows: 20, actualRows: 18 })
    })
    it('reports structural node changes by path', () => {
        const changes = comparePlans(plan('Seq Scan'), plan('Index Scan'))
        expect(changes).toHaveLength(1)
        expect(changes[0]).toMatchObject({ path: '1.1', status: 'changed' })
    })
    it('formats signed metric deltas', () => {
        expect(metricDelta(10, 7.5)).toBe('-2.5')
        expect(metricDelta(10, 12)).toBe('+2')
        expect(metricDelta(undefined, 12)).toBe('n/a')
    })
})
