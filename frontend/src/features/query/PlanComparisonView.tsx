import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { comparePlans, metricDelta, planMetrics, PlanSnapshot } from './planComparison'

export default function PlanComparisonView({ snapshots, onDelete }: { snapshots: PlanSnapshot[]; onDelete: (id: string) => void }) {
    const [beforeId, setBeforeId] = useState(snapshots.at(-2)?.id ?? snapshots[0]?.id ?? '')
    const [afterId, setAfterId] = useState(snapshots.at(-1)?.id ?? snapshots[0]?.id ?? '')
    const before = snapshots.find(snapshot => snapshot.id === beforeId) ?? snapshots[0]
    const after = snapshots.find(snapshot => snapshot.id === afterId) ?? snapshots.at(-1)
    const comparison = useMemo(() => before && after ? comparePlans(before.plan, after.plan) : [], [after, before])
    if (!before || !after) return <div className="results-empty">Pin at least two plans to compare them.</div>
    const left = planMetrics(before.plan)
    const right = planMetrics(after.plan)
    const option = (snapshot: PlanSnapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.label} / {snapshot.mode}</option>
    return <div className="plan-comparison"><div className="plan-compare-selectors"><label>Baseline<select value={before.id} onChange={event => setBeforeId(event.target.value)}>{snapshots.map(option)}</select></label><label>Compared<select value={after.id} onChange={event => setAfterId(event.target.value)}>{snapshots.map(option)}</select></label><button className="icon-btn" title="Delete baseline snapshot" onClick={() => onDelete(before.id)}><Trash2 size={12} /></button><button className="icon-btn" title="Delete compared snapshot" onClick={() => onDelete(after.id)}><Trash2 size={12} /></button></div><div className="plan-metric-grid"><span>Nodes<strong>{left.nodes} → {right.nodes}</strong><small>{metricDelta(left.nodes, right.nodes)}</small></span><span>Total cost<strong>{left.totalCost ?? 'n/a'} → {right.totalCost ?? 'n/a'}</strong><small>{metricDelta(left.totalCost, right.totalCost)}</small></span><span>Actual time<strong>{left.actualTime ?? 'n/a'} → {right.actualTime ?? 'n/a'} ms</strong><small>{metricDelta(left.actualTime, right.actualTime)}</small></span><span>Actual rows<strong>{left.actualRows ?? 'n/a'} → {right.actualRows ?? 'n/a'}</strong><small>{metricDelta(left.actualRows, right.actualRows)}</small></span></div><div className="plan-change-list">{comparison.length === 0 ? <div className="database-search-empty">Plans have the same normalized structure and metrics.</div> : comparison.map(change => <div className={`plan-change ${change.status}`} key={change.path}><span>{change.status}</span><strong>Node {change.path}</strong><code>{change.before?.replace('\n', ' / ') ?? '—'}</code><code>{change.after?.replace('\n', ' / ') ?? '—'}</code></div>)}</div></div>
}
