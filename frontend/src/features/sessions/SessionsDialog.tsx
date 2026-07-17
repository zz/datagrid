import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, Square } from 'lucide-react'
import { CancelDatabaseSession, ListDatabaseSessions } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import ConfirmDialog from '../../components/ConfirmDialog'

const elapsed = (milliseconds: number) => {
    if (milliseconds < 1000) return `${milliseconds} ms`
    const seconds = Math.floor(milliseconds / 1000)
    if (seconds < 60) return `${seconds} s`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ${seconds % 60}s`
}

export default function SessionsDialog({ connId, connectionName, onClose, onError }: {
    connId: string
    connectionName: string
    onClose: () => void
    onError: (message: string) => void
}) {
    const [sessions, setSessions] = useState<drivers.DatabaseSession[]>([])
    const [loading, setLoading] = useState(false)
    const [activeOnly, setActiveOnly] = useState(true)
    const [search, setSearch] = useState('')
    const [cancelTarget, setCancelTarget] = useState<drivers.DatabaseSession | null>(null)

    const refresh = useCallback(async () => {
        setLoading(true)
        try {
            setSessions(await ListDatabaseSessions(connId) ?? [])
        } catch (error) {
            onError(String(error))
        } finally {
            setLoading(false)
        }
    }, [connId, onError])

    useEffect(() => { void refresh() }, [refresh])

    const shown = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return sessions.filter(session => {
            const active = !!session.query.trim() && !['idle', 'sleep'].includes(session.state.toLowerCase())
            if (activeOnly && !active) return false
            return !needle || [session.id, session.user, session.database, session.state, session.client, session.query]
                .some(value => value.toLowerCase().includes(needle))
        })
    }, [activeOnly, search, sessions])

    const cancel = async () => {
        if (!cancelTarget) return
        try {
            await CancelDatabaseSession(connId, cancelTarget.id)
            await refresh()
        } catch (error) {
            onError(String(error))
        } finally {
            setCancelTarget(null)
        }
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
        <div className="modal sessions-dialog">
            <div className="sessions-title"><div><h2>Database Sessions</h2><span>{connectionName}</span></div><button className="icon-btn" onClick={onClose} title="Close">x</button></div>
            <div className="sessions-toolbar">
                <label className="sessions-search"><Search size={13} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter sessions" /></label>
                <label><input type="checkbox" checked={activeOnly} onChange={event => setActiveOnly(event.target.checked)} /> Active only</label>
                <div className="tb-spacer" />
                <span>{shown.length} of {sessions.length}</span>
                <button onClick={() => void refresh()} disabled={loading}><RefreshCw size={13} /> Refresh</button>
            </div>
            <div className="sessions-table-wrap">
                <table className="sessions-table">
                    <thead><tr><th>ID</th><th>User / Database</th><th>State</th><th>Elapsed</th><th>Client</th><th>Query</th><th /></tr></thead>
                    <tbody>{shown.map(session => <tr key={session.id} className={session.own ? 'own' : ''}>
                        <td>{session.id}{session.own && <span className="session-own">this tool</span>}</td>
                        <td><strong>{session.user}</strong><span>{session.database || '-'}</span></td>
                        <td><span className={`session-state ${['idle', 'sleep'].includes(session.state.toLowerCase()) ? 'idle' : 'active'}`}>{session.state || 'unknown'}</span></td>
                        <td>{elapsed(session.durationMs)}</td>
                        <td>{session.client || '-'}</td>
                        <td><code title={session.query}>{session.query || '-'}</code></td>
                        <td><button className="icon-btn" disabled={session.own || !session.query.trim()} onClick={() => setCancelTarget(session)} title="Cancel running query"><Square size={12} /></button></td>
                    </tr>)}</tbody>
                </table>
                {!loading && shown.length === 0 && <div className="sessions-empty">No matching sessions.</div>}
                {loading && sessions.length === 0 && <div className="sessions-empty">Loading sessions...</div>}
            </div>
            <div className="modal-buttons"><span>Visibility and cancellation depend on database permissions.</span><div className="spacer" /><button onClick={onClose}>Close</button></div>
        </div>
        {cancelTarget && <ConfirmDialog title="Cancel running query?" message={`Cancel query on backend ${cancelTarget.id} (${cancelTarget.user})? The client connection will remain open.`} confirmLabel="Cancel Query" danger onCancel={() => setCancelTarget(null)} onConfirm={cancel} />}
    </div>
}
