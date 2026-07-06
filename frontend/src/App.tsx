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
import GoToPalette from './features/navigation/GoToPalette'
import ErrorBoundary from './components/ErrorBoundary'
import ContextMenu, { MenuItem } from './components/ContextMenu'
import CopyButton from './components/CopyButton'
import SettingsDialog from './features/settings/SettingsDialog'
import ConnectionManager from './features/connections/ConnectionManager'
import { applyTheme, useSettings } from './settings'

function App() {
    const [version, setVersion] = useState('')
    const [paletteOpen, setPaletteOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [managerOpen, setManagerOpen] = useState(false)
    const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
    const {
        tabs,
        activeTabId,
        setActiveTab,
        closeTab,
        closeTabs,
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
        applyTheme(useSettings.getState().theme)
        GetAppInfo().then(info => setVersion(info.version))
        loadConnections()
        const offBatch = onQueryBatch(applyBatch)
        const offDone = onQueryDone(applyDone)
        // ⌘P / Ctrl+P opens the go-to-table palette (design: Navigation).
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
                e.preventDefault()
                setPaletteOpen(o => !o)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => {
            offBatch()
            offDone()
            window.removeEventListener('keydown', onKey)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const activeTab = tabs.find(t => t.id === activeTabId)

    // Right-click menu for an editor tab. Close-others/right are disabled when
    // there are no such tabs to close.
    const tabMenuItems = (tabId: string): MenuItem[] => {
        const idx = tabs.findIndex(t => t.id === tabId)
        const others = tabs.filter(t => t.id !== tabId).map(t => t.id)
        const toRight = tabs.slice(idx + 1).map(t => t.id)
        return [
            { label: 'Close', onClick: () => closeTab(tabId) },
            { label: 'Close others', disabled: others.length === 0, onClick: () => closeTabs(others) },
            { label: 'Close to the right', disabled: toRight.length === 0, onClick: () => closeTabs(toRight) },
            { label: 'Close all', disabled: tabs.length === 0, onClick: () => closeTabs(tabs.map(t => t.id)) },
        ]
    }

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
                            onContextMenu={e => {
                                e.preventDefault()
                                setTabMenu({ x: e.clientX, y: e.clientY, tabId: t.id })
                            }}
                            onAuxClick={e => {
                                // Middle-click closes the tab, like a browser.
                                if (e.button === 1) {
                                    e.preventDefault()
                                    closeTab(t.id)
                                }
                            }}
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
                    <button className="history-toggle" title="Connection manager" onClick={() => setManagerOpen(true)}>
                        ⛁ Connections
                    </button>
                    <button className="history-toggle" title="Settings" onClick={() => setSettingsOpen(true)}>
                        ⚙
                    </button>
                    <button className="history-toggle" title="Go to table (⌘P)" onClick={() => setPaletteOpen(true)}>
                        ⌕ Go to
                    </button>
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
                    <span className={lastError ? 'status-error' : ''} title={lastError ?? ''}>
                        {lastError ? `⚠ ${lastError.slice(0, 140)}` : 'Ready'}
                    </span>
                    {lastError && (
                        <span className="statusbar-actions">
                            <CopyButton text={lastError} />
                            <button className="copy-btn" onClick={() => setError(null)}>
                                Dismiss
                            </button>
                        </span>
                    )}
                    <span className="statusbar-right">{version && `v${version}`}</span>
                </div>
            </div>
            {historyOpen && <HistoryPanel />}
            {paletteOpen && <GoToPalette onClose={() => setPaletteOpen(false)} />}
            {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
            {managerOpen && <ConnectionManager onClose={() => setManagerOpen(false)} />}
            {dialog.open && <ConnectionDialog key={dialog.editing?.id ?? 'new'} />}
            {tabMenu && (
                <ContextMenu x={tabMenu.x} y={tabMenu.y} items={tabMenuItems(tabMenu.tabId)} onClose={() => setTabMenu(null)} />
            )}
        </div>
    )
}

export default App
