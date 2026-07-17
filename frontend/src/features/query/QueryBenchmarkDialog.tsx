import { useMemo, useState } from 'react'
import { Activity, Ban, Gauge, Save, Trash2, TrendingDown, TrendingUp } from 'lucide-react'
import { BenchmarkQuery, CancelQuery } from '../../../wailsjs/go/api/App'
import { benchmarkStats, formatBenchmarkMs } from './queryBenchmark'
import { queryParameterNames } from './queryParameters'
import { benchmarkFingerprint, compareBenchmark, loadBenchmarkBaselines, saveBenchmarkBaselines } from './benchmarkBaselines'
import NameDialog from '../../components/NameDialog'

export default function QueryBenchmarkDialog({ connId, engine, statement, initialParameters, onClose, onError }: {
    connId: string
    engine: string
    statement: string
    initialParameters: Record<string, string>
    onClose: () => void
    onError: (error: string) => void
}) {
    const names = useMemo(() => queryParameterNames(statement, engine), [engine, statement])
    const [parameters, setParameters] = useState(() => Object.fromEntries(names.map(name => [name, initialParameters[name] ?? ''])))
    const [warmups, setWarmups] = useState(1)
    const [runs, setRuns] = useState(10)
    const [running, setRunning] = useState(false)
    const [benchmarkId, setBenchmarkId] = useState('')
    const [durations, setDurations] = useState<number[]>([])
    const [rows, setRows] = useState(0)
    const [baselines, setBaselines] = useState(loadBenchmarkBaselines)
    const [baselineId, setBaselineId] = useState('')
    const [saveBaseline, setSaveBaseline] = useState(false)
    const stats = benchmarkStats(durations)
    const matchingBaselines = useMemo(() => baselines.filter(item => item.engine === engine && item.fingerprint === benchmarkFingerprint(statement)), [baselines, engine, statement])
    const baseline = matchingBaselines.find(item => item.id === baselineId)
    const regression = baseline && stats ? compareBenchmark(baseline.stats, stats) : null
    const start = async () => {
        const id = `benchmark-${Date.now()}`
        setBenchmarkId(id); setRunning(true); setDurations([])
        try { const result = await BenchmarkQuery(connId, id, statement, warmups, runs, parameters); setDurations(result.durationsMs ?? []); setRows(result.rows) }
        catch (error) { onError(String(error)) } finally { setRunning(false); setBenchmarkId('') }
    }
    const cancel = async () => { if (benchmarkId) { try { await CancelQuery(connId, benchmarkId) } catch (error) { onError(String(error)) } } }
    const metric = (label: string, value: number | undefined) => <span><small>{label}</small><strong>{value == null ? '—' : formatBenchmarkMs(value)}</strong></span>
    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !running && onClose()}>
        <div className="modal query-benchmark-dialog">
            <div className="object-source-title"><Gauge size={17} /><div><h2>Query Benchmark</h2><span>Repeated read-only execution</span></div></div>
            <div className="benchmark-controls"><label>Warmups<input type="number" min={0} max={10} value={warmups} onChange={event => setWarmups(Math.max(0, Math.min(10, Number(event.target.value))))} /></label><label>Measured runs<input type="number" min={1} max={50} value={runs} onChange={event => setRuns(Math.max(1, Math.min(50, Number(event.target.value))))} /></label><span>Full result sets are consumed for each run.</span></div>
            {names.length > 0 && <div className="benchmark-parameters">{names.map(name => <label key={name}><span>:{name}</span><input value={parameters[name]} onChange={event => setParameters(current => ({ ...current, [name]: event.target.value }))} /></label>)}</div>}
            <pre className="benchmark-sql">{statement}</pre>
            {stats ? <><div className="benchmark-metrics">{metric('Minimum', stats.min)}{metric('Average', stats.average)}{metric('Median', stats.median)}{metric('95th percentile', stats.p95)}{metric('Maximum', stats.max)}{metric('Std deviation', stats.standardDeviation)}</div><div className="benchmark-baseline"><label>Baseline<select value={baseline?.id ?? ''} onChange={event => setBaselineId(event.target.value)}><option value="">No baseline</option>{matchingBaselines.map(item => <option key={item.id} value={item.id}>{item.name} / {new Date(item.createdAt).toLocaleDateString()}</option>)}</select></label>{regression && <div className={`benchmark-regression ${regression.status}`}>{regression.status === 'regressed' ? <TrendingUp size={14} /> : regression.status === 'improved' ? <TrendingDown size={14} /> : <Activity size={14} />}<span><strong>{regression.status}</strong><small>Average {regression.averagePercent > 0 ? '+' : ''}{regression.averagePercent.toFixed(1)}% / p95 {regression.p95Percent > 0 ? '+' : ''}{regression.p95Percent.toFixed(1)}%</small></span></div>}<div className="tb-spacer" /><button onClick={() => setSaveBaseline(true)}><Save size={12} /> Save baseline</button><button className="icon-btn" disabled={!baseline} onClick={() => { if (!baseline) return; const next = baselines.filter(item => item.id !== baseline.id); setBaselines(next); saveBenchmarkBaselines(next); setBaselineId('') }} title="Delete selected baseline"><Trash2 size={12} /></button></div><div className="benchmark-runs"><div className="benchmark-run heading"><span>Run</span><span>Duration</span><span>Relative</span></div>{durations.map((duration, index) => <div className="benchmark-run" key={index}><span>{index + 1}</span><strong>{formatBenchmarkMs(duration)}</strong><span><i style={{ width: `${Math.max(2, duration / stats.max * 100)}%` }} /></span></div>)}</div></> : <div className="benchmark-empty"><Activity size={22} /><span>{running ? `Running ${warmups} warmups and ${runs} measured executions...` : 'Run the benchmark to collect timing statistics.'}</span></div>}
            <div className="modal-buttons"><span>{durations.length ? `${durations.length} runs / ${rows.toLocaleString()} rows per run` : 'Maximum 50 measured runs.'}</span><div className="spacer" /><button onClick={onClose} disabled={running}>Close</button>{running ? <button className="danger" onClick={() => void cancel()}><Ban size={12} /> Cancel</button> : <button className="primary" onClick={() => void start()} disabled={!statement.trim()}><Gauge size={12} /> Run Benchmark</button>}</div>
        </div>
        {saveBaseline && stats && <NameDialog title="Save benchmark baseline" value={`Baseline ${matchingBaselines.length + 1}`} onCancel={() => setSaveBaseline(false)} onSubmit={name => {
            const trimmed = name.trim(); if (!trimmed) return
            const fingerprint = benchmarkFingerprint(statement)
            const item = { id: `baseline-${Date.now()}`, name: trimmed, engine, connId, statement, fingerprint, parameters, rows, runs: durations.length, createdAt: Date.now(), stats }
            const next = [...baselines.filter(existing => !(existing.engine === engine && existing.fingerprint === fingerprint && existing.name.toLowerCase() === trimmed.toLowerCase())), item]
            setBaselines(next); saveBenchmarkBaselines(next); setBaselineId(item.id); setSaveBaseline(false)
        }} />}
    </div>
}
