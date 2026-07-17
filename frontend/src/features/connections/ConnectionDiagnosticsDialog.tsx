import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clipboard, Network, RefreshCw, ShieldCheck, Waypoints } from 'lucide-react'
import { Copy, DiagnoseConnection } from '../../../wailsjs/go/api/App'
import { api, drivers } from '../../../wailsjs/go/models'
import { diagnosticReport, latencySummary } from './connectionDiagnostics'

export default function ConnectionDiagnosticsDialog({ connection, onClose, onError }: { connection: drivers.ConnectionConfig; onClose: () => void; onError: (error: string) => void }) {
    const [result, setResult] = useState<api.ConnectionDiagnostics | null>(null)
    const [loading, setLoading] = useState(true)
    const run = useCallback(async () => {
        setLoading(true)
        try { setResult(await DiagnoseConnection(connection.id)) } catch (error) { onError(String(error)) } finally { setLoading(false) }
    }, [connection.id, onError])
    useEffect(() => { void run() }, [run])
    const latency = useMemo(() => latencySummary(result?.latenciesMs ?? []), [result])
    const max = Math.max(...(result?.latenciesMs ?? [1]), 1)
    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !loading && onClose()}>
        <div className="modal connection-diagnostics-dialog"><div className="object-source-title"><Network size={17} /><div><h2>Connection Diagnostics</h2><span>{connection.name}</span></div><button onClick={() => void run()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={12} /> Rerun</button></div>
            {loading && !result ? <div className="benchmark-empty"><Waypoints size={24} /><span>Testing server connectivity and session security...</span></div> : result && <><div className="diagnostic-summary"><div><small>Average latency</small><strong>{latency?.average.toFixed(2)} ms</strong><span>{latency?.min.toFixed(2)}–{latency?.max.toFixed(2)} ms</span></div><div><small>Jitter</small><strong>{latency?.jitter.toFixed(2)} ms</strong><span>5 server pings</span></div><div><small>TLS session</small><strong className={result.tlsActive ? 'good' : ''}>{result.tlsActive ? 'Active' : 'Inactive'}</strong><span>{result.tlsDetail}</span></div><div><small>SSH tunnel</small><strong className={result.sshActive ? 'good' : ''}>{result.sshActive ? 'Active' : 'Direct'}</strong><span>{result.sshActive ? result.sshHost : `${result.host}:${result.port}`}</span></div></div><div className="diagnostic-latency"><h3>Latency samples</h3>{result.latenciesMs.map((sample, index) => <div key={index}><span>Ping {index + 1}</span><i><b style={{ width: `${Math.max(3, sample / max * 100)}%` }} /></i><strong>{sample.toFixed(3)} ms</strong></div>)}</div><div className="diagnostic-details"><div><small>Engine</small><strong>{result.engine}</strong></div><div><small>Database</small><strong>{result.database || 'Default'}</strong></div><div><small>User</small><strong>{result.user}</strong></div><div><small>Endpoint</small><strong>{result.host}:{result.port}</strong></div><div className="wide"><small>Server version</small><strong>{result.serverVersion || 'Not reported'}</strong></div></div><div className="diagnostic-ok"><CheckCircle2 size={14} /> Connection checks completed at {new Date(result.checkedAt).toLocaleTimeString()}.</div></>}
            <div className="modal-buttons"><span><ShieldCheck size={12} /> Diagnostic reports never include passwords.</span><div className="spacer" /><button onClick={onClose} disabled={loading}>Close</button><button disabled={!result} onClick={() => result && Copy(diagnosticReport(connection.name, result))}><Clipboard size={12} /> Copy Report</button></div>
        </div>
    </div>
}
