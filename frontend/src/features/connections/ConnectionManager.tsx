import { useEffect, useState } from 'react'
import { ServerDatabases, SwitchDatabase } from '../../../wailsjs/go/api/App'
import { useApp } from '../../store'
import EngineIcon from '../../components/EngineIcon'

// ConnectionManager is a full-list view of all connections with inline
// connect/edit/delete and a database switcher for connected SQL servers.
export default function ConnectionManager({ onClose }: { onClose: () => void }) {
    const { connections, connected, connect, disconnect, openDialog, removeConnection, loadConnections, setError } = useApp()
    const [dbs, setDbs] = useState<Record<string, string[]>>({})

    // Fetch each connected SQL server's database list for the switcher.
    useEffect(() => {
        connections.forEach(c => {
            if (connected[c.id] && c.engine !== 'redis' && !dbs[c.id]) {
                ServerDatabases(c.id)
                    .then(list => setDbs(d => ({ ...d, [c.id]: list ?? [] })))
                    .catch(() => {})
            }
        })
    }, [connections, connected, dbs])

    const switchDb = async (connId: string, db: string) => {
        try {
            await SwitchDatabase(connId, db)
            await loadConnections()
        } catch (err) {
            setError(String(err))
        }
    }

    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal conn-manager">
                <div className="conn-manager-header">
                    <h2>Connections</h2>
                    <button className="primary" onClick={() => openDialog()}>
                        + New
                    </button>
                </div>
                <div className="conn-manager-table">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th>Name</th>
                                <th>Host</th>
                                <th>Database</th>
                                <th>Group</th>
                                <th>Env</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {connections.map(c => {
                                const isConn = connected[c.id]
                                const list = dbs[c.id] ?? []
                                return (
                                    <tr key={c.id}>
                                        <td>
                                            <EngineIcon engine={c.engine} />
                                        </td>
                                        <td className="cm-name">
                                            <span className={`conn-dot ${isConn ? 'on' : ''}`} /> {c.name}
                                        </td>
                                        <td className="cm-mono">
                                            {c.host}:{c.port}
                                        </td>
                                        <td>
                                            {c.engine !== 'redis' && isConn && list.length > 0 ? (
                                                <select value={c.database} onChange={e => switchDb(c.id, e.target.value)}>
                                                    {[...new Set([c.database, ...list])].filter(Boolean).map(d => (
                                                        <option key={d} value={d}>
                                                            {d}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span className="cm-mono">{c.database || '—'}</span>
                                            )}
                                        </td>
                                        <td>{c.group || '—'}</td>
                                        <td>
                                            {c.envLabel !== 'dev' && (
                                                <span className={`conn-badge env-${c.envLabel}`}>{c.envLabel}</span>
                                            )}
                                        </td>
                                        <td className="cm-actions">
                                            {isConn ? (
                                                <button onClick={() => disconnect(c.id)}>Disconnect</button>
                                            ) : (
                                                <button onClick={() => connect(c.id).catch(err => setError(String(err)))}>
                                                    Connect
                                                </button>
                                            )}
                                            <button onClick={() => openDialog(c)}>Edit</button>
                                            <button
                                                className="danger"
                                                onClick={() => window.confirm(`Delete "${c.name}"?`) && removeConnection(c.id)}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    )
}
