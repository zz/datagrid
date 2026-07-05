import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store'

export default function HistoryPanel() {
    const { history, loadHistory, toggleHistory, connections, tabs, activeTabId, setTabSql } = useApp()
    const [search, setSearch] = useState('')
    const debounce = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => {
        clearTimeout(debounce.current)
        debounce.current = setTimeout(() => loadHistory(search), 200)
        return () => clearTimeout(debounce.current)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search])

    const connName = (id: string) => connections.find(c => c.id === id)?.name ?? id

    // Load a statement into the active query tab's editor if one is open.
    const loadIntoEditor = (statement: string) => {
        const active = tabs.find(t => t.id === activeTabId)
        if (active && active.kind === 'query') {
            setTabSql(active.id, statement)
            toggleHistory(false)
        }
    }

    return (
        <div className="history-panel">
            <div className="history-header">
                <span>Query History</span>
                <button className="icon-btn" onClick={() => toggleHistory(false)} title="Close">
                    ×
                </button>
            </div>
            <input
                className="history-search"
                placeholder="Search statements…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
            />
            <div className="history-list">
                {history.length === 0 && <div className="history-empty">No matching history.</div>}
                {history.map(h => (
                    <div
                        key={h.id}
                        className={`history-item ${h.error ? 'has-error' : ''}`}
                        onDoubleClick={() => loadIntoEditor(h.statement)}
                        onClick={() => loadIntoEditor(h.statement)}
                        title="Click to load into the active query editor"
                    >
                        <div className="history-sql">{h.statement}</div>
                        <div className="history-meta">
                            <span>{connName(h.connId)}</span>
                            <span>{h.error ? `error: ${h.error}` : `${h.rowCount} rows`}</span>
                            <span>{h.durationMs} ms</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
