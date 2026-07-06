import { useEffect, useState } from 'react'
import { format as formatSql } from 'sql-formatter'
import SqlEditor from '../../components/SqlEditor'
import ResultsGrid from '../../components/ResultsGrid'
import PlanTree from '../../components/PlanTree'
import { ExplainQuery, ServerDatabases } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp, Tab } from '../../store'
import { useSettings } from '../../settings'
import { exportRows, ExportFormat } from '../../export'
import CopyButton from '../../components/CopyButton'

// Flags UPDATE/DELETE that lack a WHERE clause — these hit every row
// (design §5: warn regardless of the connection's environment label).
function destructiveWithoutWhere(sql: string): boolean {
    const s = sql.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!/^(update|delete)\b/.test(s)) return false
    return !/\bwhere\b/.test(s)
}

export default function QueryTab({ tab }: { tab: Tab }) {
    const q = useApp(s => s.queries[tab.id])
    const conn = useApp(s => s.connections.find(c => c.id === tab.connId))
    const schema = useApp(s => s.autocomplete[tab.connId])
    const { runQuery, cancelQuery, setTabSql, setError, switchDatabase } = useApp()
    const MAX_ROWS = useSettings(s => s.rowLimit)
    const [confirm, setConfirm] = useState<string | null>(null)
    const [plan, setPlan] = useState<drivers.PlanNode | null>(null)
    const [databases, setDatabases] = useState<string[]>([])

    // Fetch the server's databases for the active-database selector.
    useEffect(() => {
        if (conn && conn.engine !== 'redis') {
            ServerDatabases(tab.connId)
                .then(l => setDatabases(l ?? []))
                .catch(() => {})
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab.connId, conn?.engine, conn?.database])

    if (!q) return null

    const engine = conn?.engine ?? 'postgres'
    // MySQL's "schema" is the database itself; Postgres defaults to public.
    const defaultSchema = engine === 'mysql' ? conn?.database : 'public'

    const explain = async () => {
        const statement = tab.sql.trim()
        if (!statement) return
        try {
            const p = await ExplainQuery(tab.connId, statement)
            setPlan(p)
        } catch (err) {
            setError(String(err))
        }
    }

    const run = (stmt: string) => {
        const statement = stmt || tab.sql
        if (destructiveWithoutWhere(statement)) {
            setConfirm(statement)
            return
        }
        runQuery(tab.id, statement)
    }

    const format = () => {
        try {
            setTabSql(tab.id, formatSql(tab.sql, { language: engine === 'mysql' ? 'mysql' : 'postgresql' }))
        } catch (err) {
            setError(String(err))
        }
    }

    const doExport = async (fmt: ExportFormat) => {
        try {
            await exportRows(`${conn?.name ?? 'query'}-result`, fmt, q.columns, q.rows)
        } catch (err) {
            setError(String(err))
        }
    }

    const statusLine = () => {
        if (q.running) return `Running… ${q.rows.length.toLocaleString()} rows`
        const s = q.summary
        if (!s) return 'Press ⌘⏎ to run'
        if (s.error) return `Error: ${s.error}`
        const rows =
            s.rowsReturned > 0
                ? `${s.rowsReturned.toLocaleString()} rows${s.truncated ? ` (stopped at ${MAX_ROWS.toLocaleString()})` : ''}`
                : `${s.rowsAffected} affected`
        return `${rows} · ${s.durationMs} ms`
    }

    return (
        <div className="query-tab">
            <div className="query-toolbar">
                <button className="primary" disabled={q.running} onClick={() => run(tab.sql)} title="Run (⌘⏎)">
                    ▶ Run
                </button>
                <select
                    className="db-select"
                    value={conn?.database ?? ''}
                    onChange={e => switchDatabase(tab.connId, e.target.value)}
                    title="Active database"
                >
                    {!conn?.database && <option value="">(no database)</option>}
                    {[...new Set([conn?.database, ...databases])].filter(Boolean).map(d => (
                        <option key={d} value={d}>
                            {d}
                        </option>
                    ))}
                </select>
                <button disabled={!q.running} onClick={() => cancelQuery(tab.id)}>
                    ■ Cancel
                </button>
                <button disabled={q.running} onClick={explain} title="Show the query plan">
                    ⋔ Explain
                </button>
                <button onClick={format} title="Format SQL">
                    ✦ Format
                </button>
                <span className={`query-status ${q.summary?.error ? 'error' : ''}`}>{statusLine()}</span>
                {q.summary?.error && <CopyButton text={q.summary.error} />}
                {q.columns.length > 0 && (
                    <>
                        <span className="tb-spacer" />
                        <button onClick={() => doExport('csv')} title="Export results as CSV">
                            ⇩ CSV
                        </button>
                        <button onClick={() => doExport('json')} title="Export results as JSON">
                            ⇩ JSON
                        </button>
                    </>
                )}
            </div>
            <div className="query-editor">
                <SqlEditor
                    engine={engine}
                    schema={schema}
                    defaultSchema={defaultSchema}
                    value={tab.sql}
                    onChange={sql => setTabSql(tab.id, sql)}
                    onRun={run}
                />
            </div>
            <div className="query-results">
                {plan ? (
                    <div className="plan-panel">
                        <div className="plan-panel-header">
                            Query plan
                            <button className="icon-btn" onClick={() => setPlan(null)} title="Back to results">
                                ×
                            </button>
                        </div>
                        <PlanTree plan={plan} />
                    </div>
                ) : q.columns.length > 0 ? (
                    <ResultsGrid connId={tab.connId} columns={q.columns} rows={q.rows} />
                ) : (
                    <div className="results-empty">{q.running ? 'Waiting for first rows…' : 'No results'}</div>
                )}
            </div>

            {confirm !== null && (
                <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setConfirm(null)}>
                    <div className="modal modal-warn">
                        <h2>⚠ Statement affects every row</h2>
                        <p>
                            This <b>{/^update/i.test(confirm) ? 'UPDATE' : 'DELETE'}</b> has no <code>WHERE</code> clause,
                            so it will change or remove all rows in the table.
                        </p>
                        <pre className="modal-sql">{confirm}</pre>
                        <div className="modal-buttons">
                            <div className="spacer" />
                            <button onClick={() => setConfirm(null)}>Cancel</button>
                            <button
                                className="danger"
                                onClick={() => {
                                    runQuery(tab.id, confirm)
                                    setConfirm(null)
                                }}
                            >
                                Run anyway
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
