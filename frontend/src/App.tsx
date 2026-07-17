import { useEffect, useMemo, useState } from 'react'
import { Clock3, Command, Database, FileSearch, PanelLeft, Search, Settings } from 'lucide-react'
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
import { useWorkspace } from './workspace'
import ResizeHandle from './components/ResizeHandle'
import CommandPalette from './features/navigation/CommandPalette'
import { createWorkbenchCommands, displayShortcut, matchesShortcut } from './commands'
import NameDialog from './components/NameDialog'
import DatabaseSearchDialog from './features/search/DatabaseSearchDialog'

function App() {
    const [version, setVersion] = useState('')
    const [paletteOpen, setPaletteOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [managerOpen, setManagerOpen] = useState(false)
    const [commandOpen, setCommandOpen] = useState(false)
    const [databaseSearchOpen, setDatabaseSearchOpen] = useState(false)
    const [renameTabId, setRenameTabId] = useState<string | null>(null)
    const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
    const { explorerOpen, explorerWidth, bottomPanelHeight, setExplorerOpen, setExplorerWidth, setBottomPanelHeight } =
        useWorkspace()
    const {
        connections,
        connected,
        tabs,
        activeTabId,
        setActiveTab,
        closeTab,
        closeTabs,
        renameTab,
        dialog,
        lastError,
        setError,
        loadConnections,
        openDialog,
        openQueryTab,
        applyBatch,
        applyDone,
        historyOpen,
        toggleHistory,
    } = useApp()

    const activeConnectionId = tabs.find(tab => tab.id === activeTabId)?.connId ?? connections.find(c => connected[c.id])?.id
    const commands = useMemo(
        () =>
            createWorkbenchCommands({
                explorerOpen,
                historyOpen,
                canOpenConsole: !!activeConnectionId,
                toggleExplorer: () => setExplorerOpen(!explorerOpen),
                toggleHistory: () => toggleHistory(!historyOpen),
                openConnections: () => setManagerOpen(true),
                openNewConnection: () => openDialog(),
                openConsole: () => activeConnectionId && openQueryTab(activeConnectionId),
                openGoTo: () => setPaletteOpen(true),
                openSettings: () => setSettingsOpen(true),
            }),
        [
            activeConnectionId,
            explorerOpen,
            historyOpen,
            openDialog,
            openQueryTab,
            setExplorerOpen,
            toggleHistory,
        ],
    )

    useEffect(() => {
        applyTheme(useSettings.getState().theme)
        GetAppInfo().then(info => setVersion(info.version))
        loadConnections()
        const offBatch = onQueryBatch(applyBatch)
        const offDone = onQueryDone(applyDone)
        return () => {
            offBatch()
            offDone()
        }
        // Event bridges and initial metadata loading are installed once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault()
                setCommandOpen(open => !open)
                return
            }
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
                e.preventDefault()
                setDatabaseSearchOpen(open => !open)
                return
            }
            const command = commands.find(item => item.shortcut && matchesShortcut(e, item.shortcut))
            if (command?.enabled) {
                e.preventDefault()
                command.run()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [commands])

    const activeTab = tabs.find(t => t.id === activeTabId)

    // Right-click menu for an editor tab. Close-others/right are disabled when
    // there are no such tabs to close.
    const tabMenuItems = (tabId: string): MenuItem[] => {
        const idx = tabs.findIndex(t => t.id === tabId)
        const target = tabs[idx]
        const others = tabs.filter(t => t.id !== tabId).map(t => t.id)
        const toRight = tabs.slice(idx + 1).map(t => t.id)
        return [
            ...(target?.kind === 'query' ? [{ label: 'Rename Console…', onClick: () => setRenameTabId(tabId) }] : []),
            { label: 'Close', onClick: () => closeTab(tabId) },
            { label: 'Close others', disabled: others.length === 0, onClick: () => closeTabs(others) },
            { label: 'Close to the right', disabled: toRight.length === 0, onClick: () => closeTabs(toRight) },
            { label: 'Close all', disabled: tabs.length === 0, onClick: () => closeTabs(tabs.map(t => t.id)) },
        ]
    }

    return (
        <div className="shell">
            {explorerOpen && (
                <>
                    <aside
                        className="sidebar"
                        style={{ '--wails-draggable': 'drag', width: explorerWidth } as React.CSSProperties}
                    >
                        <ErrorBoundary compact label="The connection list">
                            <Sidebar />
                        </ErrorBoundary>
                    </aside>
                    <ResizeHandle
                        axis="horizontal"
                        title="Resize Database Explorer"
                        onResize={delta => setExplorerWidth(explorerWidth + delta)}
                    />
                </>
            )}
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
                    <button
                        className={`workbench-action ${explorerOpen ? 'active' : ''}`}
                        title={`Database Explorer (${displayShortcut('Mod+1')})`}
                        aria-label="Database Explorer"
                        onClick={() => setExplorerOpen(!explorerOpen)}
                    >
                        <PanelLeft size={15} />
                    </button>
                    <button className="workbench-action" title="Data Sources and Drivers" aria-label="Data Sources and Drivers" onClick={() => setManagerOpen(true)}>
                        <Database size={15} />
                    </button>
                    <button className="workbench-action" title={`Settings (${displayShortcut('Mod+,')})`} aria-label="Settings" onClick={() => setSettingsOpen(true)}>
                        <Settings size={15} />
                    </button>
                    <button className="workbench-action" title={`Go to Table (${displayShortcut('Mod+P')})`} aria-label="Go to Table" onClick={() => setPaletteOpen(true)}>
                        <Search size={15} />
                    </button>
                    <button className="workbench-action" title={`Search Database Objects (${displayShortcut('Mod+Shift+F')})`} aria-label="Search Database Objects" onClick={() => setDatabaseSearchOpen(true)}>
                        <FileSearch size={15} />
                    </button>
                    <button className="workbench-action" title={`Find Action (${displayShortcut('Mod+Shift+P')})`} aria-label="Find Action" onClick={() => setCommandOpen(true)}>
                        <Command size={15} />
                    </button>
                    <button
                        className={`workbench-action ${historyOpen ? 'active' : ''}`}
                        title={`Query History (${displayShortcut('Mod+2')})`}
                        aria-label="Query History"
                        onClick={() => toggleHistory(!historyOpen)}
                    >
                        <Clock3 size={15} />
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
                {historyOpen && (
                    <>
                        <ResizeHandle
                            axis="vertical"
                            title="Resize Query History"
                            onResize={delta => setBottomPanelHeight(bottomPanelHeight - delta)}
                        />
                        <div className="bottom-tool-window" style={{ height: bottomPanelHeight }}>
                            <HistoryPanel />
                        </div>
                    </>
                )}
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
            {paletteOpen && <GoToPalette onClose={() => setPaletteOpen(false)} />}
            {commandOpen && <CommandPalette commands={commands} onClose={() => setCommandOpen(false)} />}
            {databaseSearchOpen && <DatabaseSearchDialog initialConnId={activeConnectionId} onClose={() => setDatabaseSearchOpen(false)} />}
            {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
            {managerOpen && <ConnectionManager onClose={() => setManagerOpen(false)} />}
            {renameTabId && (
                <NameDialog
                    title="Rename Console"
                    value={tabs.find(tab => tab.id === renameTabId)?.title ?? ''}
                    onCancel={() => setRenameTabId(null)}
                    onSubmit={title => {
                        renameTab(renameTabId, title)
                        setRenameTabId(null)
                    }}
                />
            )}
            {dialog.open && <ConnectionDialog key={dialog.editing?.id ?? 'new'} />}
            {tabMenu && (
                <ContextMenu x={tabMenu.x} y={tabMenu.y} items={tabMenuItems(tabMenu.tabId)} onClose={() => setTabMenu(null)} />
            )}
        </div>
    )
}

export default App
