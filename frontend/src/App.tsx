import { useEffect, useState } from 'react'
import './App.css'
import { GetAppInfo } from '../wailsjs/go/api/App'
import { useApp } from './store'
import { onQueryBatch, onQueryDone } from './ipc/events'
import Sidebar from './features/connections/Sidebar'
import ConnectionDialog from './features/connections/ConnectionDialog'
import QueryTab from './features/query/QueryTab'
import TableDataTab from './features/tabledata/TableDataTab'
import RedisTab from './features/redis/RedisTab'
import HistoryPanel from './features/history/HistoryPanel'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
    const [version, setVersion] = useState('')
    const {
        tabs,
        activeTabId,
        setActiveTab,
        closeTab,
        dialog,
        lastError,
        setError,
        loadConnections,
        applyBatch,
        applyDone,
        historyOpen,
        toggleHistory,
    } = useApp()

    useEffect(() => {
        GetAppInfo().then(info => setVersion(info.version))
        loadConnections()
        const offBatch = onQueryBatch(applyBatch)
        const offDone = onQueryDone(applyDone)
        return () => {
            offBatch()
            offDone()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const activeTab = tabs.find(t => t.id === activeTabId)

    return (
        <div className="shell">
            <aside className="sidebar" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
                <ErrorBoundary compact label="The connection list">
                    <Sidebar />
                </ErrorBoundary>
            </aside>
            <div className="main">
                <div className="tabstrip" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
                    {tabs.length === 0 && <div className="tab active">Welcome</div>}
                    {tabs.map(t => (
                        <div
                            key={t.id}
                            className={`tab ${t.id === activeTabId ? 'active' : ''}`}
                            onClick={() => setActiveTab(t.id)}
                        >
                            <span className={`tab-kind ${t.kind}`}>
                                {t.kind === 'table' ? '▦' : t.kind === 'redis' ? '◆' : '›_'}
                            </span>
                            {t.title}
                            <span
                                className="tab-close"
                                onClick={e => {
                                    e.stopPropagation()
                                    closeTab(t.id)
                                }}
                            >
                                ×
                            </span>
                        </div>
                    ))}
                    <span className="tabstrip-spacer" />
                    <button
                        className={`history-toggle ${historyOpen ? 'active' : ''}`}
                        title="Query history"
                        onClick={() => toggleHistory(!historyOpen)}
                    >
                        🕘 History
                    </button>
                </div>
                <div className="content">
                    {activeTab ? (
                        // Keep every tab mounted so editors/results survive switching.
                        tabs.map(t => (
                            <div key={t.id} className="tab-pane" style={{ display: t.id === activeTabId ? 'flex' : 'none' }}>
                                <ErrorBoundary resetKey={t.id} compact label="This tab">
                                    {t.kind === 'table' ? (
                                        <TableDataTab tab={t} />
                                    ) : t.kind === 'redis' ? (
                                        <RedisTab tab={t} />
                                    ) : (
                                        <QueryTab tab={t} />
                                    )}
                                </ErrorBoundary>
                            </div>
                        ))
                    ) : (
                        <div className="welcome">
                            <h1>DataGrid</h1>
                            <p>Connect to a database on the left, open a query tab (✎), or double-click a table.</p>
                        </div>
                    )}
                </div>
                <div className="statusbar">
                    <span className={lastError ? 'status-error' : ''} onClick={() => setError(null)} title={lastError ?? ''}>
                        {lastError ? `⚠ ${lastError.slice(0, 120)}` : 'Ready'}
                    </span>
                    <span className="statusbar-right">{version && `v${version}`}</span>
                </div>
            </div>
            {historyOpen && <HistoryPanel />}
            {dialog.open && <ConnectionDialog key={dialog.editing?.id ?? 'new'} />}
        </div>
    )
}

export default App
