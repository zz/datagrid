import { useState } from 'react'
import SqlEditor from '../../components/SqlEditor'
import ResultsGrid from '../../components/ResultsGrid'
import PlanTree from '../../components/PlanTree'
import { ExplainQuery } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp, MAX_ROWS, Tab } from '../../store'

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
    const { runQuery, cancelQuery, setTabSql, setError } = useApp()
    const [confirm, setConfirm] = useState<string | null>(null)
    const [plan, setPlan] = useState<drivers.PlanNode | null>(null)

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
                <button disabled={!q.running} onClick={() => cancelQuery(tab.id)}>
                    ■ Cancel
                </button>
                <button disabled={q.running} onClick={explain} title="Show the query plan">
                    ⋔ Explain
                </button>
                <span className={`query-status ${q.summary?.error ? 'error' : ''}`}>{statusLine()}</span>
            </div>
            <div className="query-editor">
                <SqlEditor
                    engine={engine}
                    schema={schema}
                    defaultSchema={defaultSchema}
                    initialSql={tab.sql}
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
