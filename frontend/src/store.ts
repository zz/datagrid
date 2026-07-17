import { create } from 'zustand'
import {
    ApplyChangeset,
    BeginTransaction,
    CancelQuery,
    CommitTransaction,
    Connect,
    DeleteConnection,
    Disconnect,
    FetchQueryPage,
    GetAutocomplete,
    ListConnections,
    ListHistory,
    CountTableRows,
    LoadTableRows,
    OpenTable,
    PreviewChangeset,
    RedisCommand,
    RedisDatabases,
    RedisDelete,
    RedisGet,
    RedisScan,
    RedisSetString,
    RedisSetTTL,
    RollbackTransaction,
    SaveConnection,
    SetReadOnly,
    SwitchDatabase,
    RunQuery,
} from '../wailsjs/go/api/App'
import { drivers } from '../wailsjs/go/models'
import { meta } from '../wailsjs/go/models'
import type { Column, QuerySummary, RowBatch, Value } from './ipc/types'
import { pageSize as settingsPageSize, rowLimit as settingsRowLimit } from './settings'
import { loadConsoleSnapshot, saveConsoleSnapshot } from './consolePersistence'
import { pushEditSnapshot, revertPendingChange, stepEditHistory, TableEditSnapshot } from './features/tabledata/tableEditHistory'

// Fallback defaults; the effective values come from the settings store.
export const PAGE_SIZE = 200
export const MAX_ROWS = 10_000

export interface QueryState {
    queryId: string | null
    running: boolean
    columns: Column[]
    rows: Value[][]
    summary: QuerySummary | null
    transactionActive: boolean
    transactionBusy: boolean
    parameterValues: Record<string, string>
    resultSets: QueryResult[]
    activeResultIndex: number
}

export interface QueryResult {
    index: number
    statement: string
    columns: Column[]
    rows: Value[][]
    summary: QuerySummary | null
}

export interface Tab {
    id: string
    connId: string
    title: string
    kind: 'query' | 'table' | 'redis'
    sql: string
    // Table tabs only:
    schema?: string
    table?: string
    objectKind?: 'table' | 'view'
}

export interface ReplLine {
    command: string
    text: string
    error: boolean
}

export interface RedisView {
    db: number
    databases: drivers.RedisDB[]
    pattern: string
    typeFilter: string
    keys: drivers.RedisKey[]
    cursor: number
    hasMore: boolean
    loading: boolean
    selectedKey: string | null
    value: drivers.RedisValue | null
    repl: ReplLine[]
    error: string | null
}

const emptyRedisView = (): RedisView => ({
    db: 0,
    databases: [],
    pattern: '',
    typeFilter: '',
    keys: [],
    cursor: 0,
    hasMore: false,
    loading: false,
    selectedKey: null,
    value: null,
    repl: [],
    error: null,
})

export interface PendingEdit {
    kind: 'update' | 'insert' | 'delete'
    // For updates/deletes: the row's PK values (column → text).
    key: Record<string, string>
    // For updates/inserts: changed columns (column → CellInput-ish).
    set: Record<string, { null: boolean; text: string }>
    // Local row index this edit maps to (for display); -1 for detached.
    rowIndex: number
}

export interface TableView {
    info: drivers.TableInfo | null
    columns: Column[]
    rows: Value[][]
    baseRows: Value[][]
    sorts: drivers.SortSpec[]
    filters: drivers.FilterSpec[]
    whereRaw: string
    total: number | null // total matching rows; null until counted
    page: number
    hasMore: boolean
    loading: boolean
    error: string | null
    edits: PendingEdit[]
    undoStack: TableEditSnapshot[]
    redoStack: TableEditSnapshot[]
    previews: string[]
    conflicts: drivers.ChangeConflict[]
    colWidths: Record<string, number>
    hiddenColumns: string[]
}

const emptyTableView = (): TableView => ({
    info: null,
    columns: [],
    rows: [],
    baseRows: [],
    sorts: [],
    filters: [],
    whereRaw: '',
    total: null,
    page: 0,
    hasMore: false,
    loading: false,
    error: null,
    edits: [],
    undoStack: [],
    redoStack: [],
    previews: [],
    conflicts: [],
    colWidths: {},
    hiddenColumns: [],
})

const emptyQuery = (): QueryState => ({
    queryId: null,
    running: false,
    columns: [],
    rows: [],
    summary: null,
    transactionActive: false,
    transactionBusy: false,
    parameterValues: {},
    resultSets: [],
    activeResultIndex: 0,
})

let nextId = 1
const genId = (prefix: string) => `${prefix}-${nextId++}-${Date.now().toString(36)}`

const restoredConsoles = loadConsoleSnapshot()
const restoredTabs: Tab[] = restoredConsoles.consoles.map(console => ({ ...console, kind: 'query' }))
const restoredQueries = Object.fromEntries(restoredTabs.map(tab => [tab.id, emptyQuery()]))
let persistTimer: ReturnType<typeof setTimeout> | undefined

function persistConsoles(get: () => AppState) {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
        const state = get()
        const consoles = state.tabs
            .filter(tab => tab.kind === 'query')
            .map(({ id, connId, title, sql }) => ({ id, connId, title, sql }))
        const activeConsoleId = consoles.some(console => console.id === state.activeTabId) ? state.activeTabId : null
        saveConsoleSnapshot({ consoles, activeConsoleId })
    }, 150)
}

interface AppState {
    connections: drivers.ConnectionConfig[]
    connected: Record<string, boolean>
    connecting: Record<string, boolean>
    // "schema.table" → columns, per connection; feeds editor autocomplete.
    autocomplete: Record<string, Record<string, string[]>>
    dialog: { open: boolean; editing: drivers.ConnectionConfig | null }
    tabs: Tab[]
    activeTabId: string | null
    queries: Record<string, QueryState> // by tab id
    queryToTab: Record<string, string>
    queryAppends: Record<string, boolean>
    tableViews: Record<string, TableView> // by tab id
    redisViews: Record<string, RedisView> // by tab id
    history: meta.HistoryEntry[]
    historyOpen: boolean
    lastError: string | null

    loadConnections: () => Promise<void>
    connect: (connId: string) => Promise<void>
    disconnect: (connId: string) => Promise<void>
    removeConnection: (connId: string) => Promise<void>
    setConnectionGroup: (connId: string, group: string) => Promise<void>
    setConnectionReadOnly: (connId: string, readOnly: boolean) => Promise<void>
    renameGroup: (oldName: string, newName: string) => Promise<void>
    switchDatabase: (connId: string, database: string) => Promise<void>
    openDialog: (editing?: drivers.ConnectionConfig) => void
    closeDialog: () => void
    openQueryTab: (connId: string, sql?: string, title?: string) => void
    openTableTab: (connId: string, schema: string, table: string, objectKind?: 'table' | 'view') => Promise<void>
    openTableWithFilter: (connId: string, schema: string, table: string, column: string, value: string, op?: string) => Promise<void>
    openRedisTab: (connId: string, db: number) => Promise<void>
    closeTab: (tabId: string) => void
    closeTabs: (tabIds: string[]) => void
    setActiveTab: (tabId: string) => void
    setTabSql: (tabId: string, sql: string) => void
    renameTab: (tabId: string, title: string) => void
    runQuery: (tabId: string, statement: string, parameters?: Record<string, string>, schemaContext?: string[], maxRows?: number, timeoutMs?: number) => Promise<void>
    runQueryView: (tabId: string, statement: string, parameters?: Record<string, string>, schemaContext?: string[], maxRows?: number, timeoutMs?: number) => Promise<void>
    fetchMoreQuery: (tabId: string, statement: string, resultIndex: number, offset: number, parameters?: Record<string, string>, schemaContext?: string[], pageSize?: number, timeoutMs?: number, replace?: boolean) => Promise<void>
    cancelQuery: (tabId: string) => Promise<void>
    beginTransaction: (tabId: string) => Promise<void>
    commitTransaction: (tabId: string) => Promise<void>
    rollbackTransaction: (tabId: string) => Promise<void>
    setActiveResult: (tabId: string, index: number) => void
    replaceQueryResultRows: (tabId: string, index: number, rows: Value[][]) => void
    applyBatch: (batch: RowBatch) => void
    applyDone: (summary: QuerySummary) => void
    // Table view actions:
    reloadTable: (tabId: string, recount?: boolean, refreshInfo?: boolean) => Promise<void>
    setTableSort: (tabId: string, column: string) => Promise<void>
    setTableFilters: (tabId: string, filters: drivers.FilterSpec[]) => Promise<void>
    setTableWhere: (tabId: string, whereRaw: string) => Promise<void>
    setTablePage: (tabId: string, page: number) => Promise<void>
    setColWidth: (tabId: string, column: string, width: number) => void
    setColumnVisible: (tabId: string, column: string, visible: boolean) => void
    showAllColumns: (tabId: string) => void
    stageEdit: (tabId: string, rowIndex: number, column: string, text: string, isNull: boolean) => void
    stageEditBatch: (tabId: string, changes: Array<{ rowIndex: number; column: string; text: string; isNull: boolean }>) => void
    stageInsert: (tabId: string) => void
    stageDuplicate: (tabId: string, rowIndex: number) => void
    stageDelete: (tabId: string, rowIndex: number) => void
    stageDeleteBatch: (tabId: string, rowIndexes: number[]) => void
    undoTableEdit: (tabId: string) => void
    redoTableEdit: (tabId: string) => void
    revertTableEdit: (tabId: string, editIndex: number, column?: string) => void
    discardEdits: (tabId: string) => void
    applyEdits: (tabId: string, force?: boolean) => Promise<void>
    dismissEditConflicts: (tabId: string) => void
    // Redis view actions:
    redisScan: (tabId: string, reset: boolean) => Promise<void>
    redisSetDb: (tabId: string, db: number) => Promise<void>
    redisSetPattern: (tabId: string, pattern: string, typeFilter: string) => void
    redisSelectKey: (tabId: string, key: string) => Promise<void>
    redisSaveString: (tabId: string, value: string) => Promise<void>
    redisSaveTTL: (tabId: string, seconds: number) => Promise<void>
    redisDeleteKey: (tabId: string, key: string) => Promise<void>
    redisRunCommand: (tabId: string, command: string) => Promise<void>
    // History actions:
    loadHistory: (search: string) => Promise<void>
    toggleHistory: (open: boolean) => void
    // Flip a connection's dot to disconnected when an op fails with what
    // looks like a dropped/unreachable connection, so the UI stops implying
    // it is still live.
    markMaybeDisconnected: (connId: string, err: unknown) => void
    // Flip the dot back to connected after an op succeeds — the backend
    // tunnel/pool self-heals, so a past failure shouldn't grey it forever.
    markAlive: (connId: string) => void
    setError: (msg: string | null) => void
}

// Error-message signatures that mean the connection is gone rather than the
// query itself being bad. Kept broad on purpose — a false positive only
// greys a dot the user can re-click to reconnect.
function looksDisconnected(msg: string): boolean {
    return /connection refused|connection reset|broken pipe|\bEOF\b|closed pool|conn closed|server closed|no such host|i\/o timeout|context deadline exceeded|bad connection|dial tcp|network is unreachable|connect:|not connected/i.test(
        msg,
    )
}

export const useApp = create<AppState>((set, get) => ({
    connections: [],
    connected: {},
    connecting: {},
    autocomplete: {},
    tableViews: {},
    redisViews: {},
    history: [],
    historyOpen: false,
    dialog: { open: false, editing: null },
    tabs: restoredTabs,
    activeTabId: restoredConsoles.activeConsoleId,
    queries: restoredQueries,
    queryToTab: {},
    queryAppends: {},
    lastError: null,

    loadConnections: async () => {
        const list = await ListConnections()
        set({ connections: list ?? [] })
    },

    connect: async (connId) => {
        set(s => ({ connecting: { ...s.connecting, [connId]: true } }))
        try {
            await Connect(connId)
            set(s => ({ connected: { ...s.connected, [connId]: true } }))
            // Fetch autocomplete in the background; failures are harmless.
            GetAutocomplete(connId)
                .then(m => set(s => ({ autocomplete: { ...s.autocomplete, [connId]: m ?? {} } })))
                .catch(() => {})
        } finally {
            set(s => ({ connecting: { ...s.connecting, [connId]: false } }))
        }
    },

    disconnect: async (connId) => {
        await Disconnect(connId)
        set(s => ({ connected: { ...s.connected, [connId]: false } }))
    },

    removeConnection: async (connId) => {
        await DeleteConnection(connId)
        await get().loadConnections()
        set(s => ({
            tabs: s.tabs.filter(t => t.connId !== connId),
            connected: { ...s.connected, [connId]: false },
        }))
    },

    // Reassign a connection's sidebar folder. Saved with an empty password so
    // the Keychain secret is preserved.
    setConnectionGroup: async (connId, group) => {
        const c = get().connections.find(x => x.id === connId)
        if (!c || c.group === group) return
        await SaveConnection(drivers.ConnectionConfig.createFrom({ ...c, group }), '')
        await get().loadConnections()
    },

    // Toggle a connection's read-only flag. Persists to the saved config and,
    // if the connection is open, applies to the live session immediately so no
    // reconnect is needed (best-effort — ignored when not connected).
    setConnectionReadOnly: async (connId, readOnly) => {
        const c = get().connections.find(x => x.id === connId)
        if (!c || !!c.readOnly === readOnly) return
        await SaveConnection(drivers.ConnectionConfig.createFrom({ ...c, readOnly }), '')
        await SetReadOnly(connId, readOnly).catch(() => {})
        await get().loadConnections()
    },

    renameGroup: async (oldName, newName) => {
        for (const c of get().connections.filter(x => x.group === oldName)) {
            await SaveConnection(drivers.ConnectionConfig.createFrom({ ...c, group: newName }), '')
        }
        await get().loadConnections()
    },

    switchDatabase: async (connId, database) => {
        try {
            await SwitchDatabase(connId, database)
            await get().loadConnections()
            // Refresh autocomplete for the new database.
            GetAutocomplete(connId)
                .then(m => set(s => ({ autocomplete: { ...s.autocomplete, [connId]: m ?? {} } })))
                .catch(() => {})
        } catch (err) {
            set({ lastError: String(err) })
        }
    },

    openDialog: (editing) => set({ dialog: { open: true, editing: editing ?? null } }),
    closeDialog: () => set({ dialog: { open: false, editing: null } }),

    openQueryTab: (connId, sql = '', title) => {
        const conn = get().connections.find(c => c.id === connId)
        const number = get().tabs.filter(tab => tab.kind === 'query' && tab.connId === connId).length + 1
        const tab: Tab = {
            id: genId('tab'),
            connId,
            title: title || `${conn?.name ?? 'Query'} console ${number}`,
            kind: 'query',
            sql,
        }
        set(s => ({
            tabs: [...s.tabs, tab],
            activeTabId: tab.id,
            queries: { ...s.queries, [tab.id]: emptyQuery() },
        }))
        persistConsoles(get)
    },

    openTableTab: async (connId, schema, table, objectKind = 'table') => {
        // Reuse an existing tab for the same table if one is open.
        const existing = get().tabs.find(
            t => t.kind === 'table' && t.connId === connId && t.schema === schema && t.table === table,
        )
        if (existing) {
            set({ activeTabId: existing.id })
            return
        }
        const tab: Tab = {
            id: genId('tab'),
            connId,
            title: table,
            kind: 'table',
            sql: '',
            schema,
            table,
            objectKind,
        }
        set(s => ({
            tabs: [...s.tabs, tab],
            activeTabId: tab.id,
            tableViews: { ...s.tableViews, [tab.id]: emptyTableView() },
        }))
        await get().reloadTable(tab.id, true)
    },

    openTableWithFilter: async (connId, schema, table, column, value, op = '=') => {
        await get().openTableTab(connId, schema, table)
        const target = get().tabs.find(
            tab => tab.kind === 'table' && tab.connId === connId && tab.schema === schema && tab.table === table,
        )
        if (!target) return
        await get().setTableFilters(target.id, [drivers.FilterSpec.createFrom({ column, op, value })])
    },

    openRedisTab: async (connId, db) => {
        const existing = get().tabs.find(t => t.kind === 'redis' && t.connId === connId)
        if (existing) {
            set({ activeTabId: existing.id })
            if (db !== get().redisViews[existing.id]?.db) await get().redisSetDb(existing.id, db)
            return
        }
        const conn = get().connections.find(c => c.id === connId)
        const tab: Tab = {
            id: genId('tab'),
            connId,
            title: conn ? conn.name : 'Redis',
            kind: 'redis',
            sql: '',
        }
        set(s => ({
            tabs: [...s.tabs, tab],
            activeTabId: tab.id,
            redisViews: { ...s.redisViews, [tab.id]: { ...emptyRedisView(), db } },
        }))
        try {
            const databases = await RedisDatabases(connId)
            setRedis(set, tab.id, { databases: databases ?? [] })
        } catch (err) {
            setRedis(set, tab.id, { error: String(err) })
        }
        await get().redisScan(tab.id, true)
    },

    closeTab: (tabId) => get().closeTabs([tabId]),

    closeTabs: (tabIds) => {
        const drop = new Set(tabIds)
        for (const tab of get().tabs.filter(tab => drop.has(tab.id) && get().queries[tab.id]?.transactionActive)) {
            const query = get().queries[tab.id]
            const rollback = () => RollbackTransaction(tab.connId, tab.id).catch(() => {})
            if (query.running && query.queryId) CancelQuery(tab.connId, query.queryId).finally(rollback)
            else rollback()
        }
        set(s => {
            const tabs = s.tabs.filter(t => !drop.has(t.id))
            const queries = { ...s.queries }
            const tableViews = { ...s.tableViews }
            const redisViews = { ...s.redisViews }
            for (const id of drop) {
                delete queries[id]
                delete tableViews[id]
                delete redisViews[id]
            }
            // Keep a valid active tab: if the active one was closed, fall back
            // to the last remaining tab (or none).
            const activeTabId =
                s.activeTabId && drop.has(s.activeTabId)
                    ? tabs.length
                        ? tabs[tabs.length - 1].id
                        : null
                    : s.activeTabId
            return { tabs, queries, tableViews, redisViews, activeTabId }
        })
        persistConsoles(get)
    },

    setActiveTab: (tabId) => {
        set({ activeTabId: tabId })
        persistConsoles(get)
    },
    setTabSql: (tabId, sql) => {
        set(s => ({ tabs: s.tabs.map(t => (t.id === tabId ? { ...t, sql } : t)) }))
        persistConsoles(get)
    },
    renameTab: (tabId, title) => {
        const trimmed = title.trim()
        if (!trimmed) return
        set(s => ({ tabs: s.tabs.map(tab => (tab.id === tabId ? { ...tab, title: trimmed } : tab)) }))
        persistConsoles(get)
    },

    runQuery: async (tabId, statement, parameters = {}, schemaContext = [], maxRows = settingsRowLimit(), timeoutMs = 0) => {
        const tab = get().tabs.find(t => t.id === tabId)
        if (!tab || !statement.trim()) return
        const queryId = genId('q')
        set(s => ({
            queries: {
                ...s.queries,
                [tabId]: {
                    ...emptyQuery(),
                    transactionActive: s.queries[tabId]?.transactionActive ?? false,
                    parameterValues: { ...s.queries[tabId]?.parameterValues, ...parameters },
                    queryId,
                    running: true,
                },
            },
            queryToTab: { ...s.queryToTab, [queryId]: tabId },
        }))
        try {
            await RunQuery(
                tab.connId,
                queryId,
                statement,
                maxRows,
                get().queries[tabId]?.transactionActive ? tab.id : '',
                parameters,
                schemaContext,
                timeoutMs,
            )
        } catch (err) {
            set(s => ({
                queries: {
                    ...s.queries,
                    [tabId]: {
                        ...s.queries[tabId],
                        running: false,
                        summary: {
                            queryId,
                            rowsAffected: 0,
                            rowsReturned: 0,
                            durationMs: 0,
                            truncated: false,
                            error: String(err),
                        },
                    },
                },
            }))
        }
    },

    runQueryView: async (tabId, statement, parameters = {}, schemaContext = [], maxRows = settingsRowLimit(), timeoutMs = 0) => {
        const tab = get().tabs.find(item => item.id === tabId)
        const previous = get().queries[tabId]
        if (!tab || !previous || previous.running || !statement.trim()) return
        const source = previous.resultSets.find(result => result.index === previous.activeResultIndex) ?? {
            index: 0, statement: '', columns: previous.columns, rows: previous.rows, summary: previous.summary,
        }
        const queryId = genId('view')
        set(state => ({
            queries: {
                ...state.queries,
                [tabId]: {
                    ...previous,
                    queryId,
                    running: true,
                    columns: source.columns,
                    rows: [],
                    summary: null,
                    resultSets: [{ ...source, index: 0, rows: [], summary: null }],
                    activeResultIndex: 0,
                    parameterValues: { ...previous.parameterValues, ...parameters },
                },
            },
            queryToTab: { ...state.queryToTab, [queryId]: tabId },
        }))
        try {
            await RunQuery(
                tab.connId,
                queryId,
                statement,
                maxRows,
                previous.transactionActive ? tab.id : '',
                parameters,
                schemaContext,
                timeoutMs,
            )
        } catch (error) {
            set(state => {
                const current = state.queries[tabId]
                if (!current || current.queryId !== queryId) return state
                const failure: QuerySummary = { queryId, rowsAffected: 0, rowsReturned: 0, durationMs: 0, truncated: false, error: String(error), resultIndex: 0, statement, final: true }
                return { queries: { ...state.queries, [tabId]: { ...current, running: false, summary: failure, resultSets: current.resultSets.map(result => ({ ...result, statement, summary: failure })) } } }
            })
        }
    },

    fetchMoreQuery: async (tabId, statement, resultIndex, offset, parameters = {}, schemaContext = [], pageSize = settingsRowLimit(), timeoutMs = 0, replace = false) => {
        const tab = get().tabs.find(item => item.id === tabId)
        const query = get().queries[tabId]
        if (!tab || !query || query.running || !statement.trim()) return
        const queryId = genId('fetch')
        set(state => ({
            queries: { ...state.queries, [tabId]: {
                ...query,
                queryId,
                running: true,
                rows: replace && resultIndex === 0 ? [] : query.rows,
                resultSets: replace ? query.resultSets.map(result => result.index === resultIndex ? { ...result, rows: [], summary: null } : result) : query.resultSets,
            } },
            queryToTab: { ...state.queryToTab, [queryId]: tabId },
            queryAppends: { ...state.queryAppends, [queryId]: true },
        }))
        try {
            await FetchQueryPage(tab.connId, queryId, statement, offset, pageSize, resultIndex, query.transactionActive ? tab.id : '', parameters, schemaContext, timeoutMs)
        } catch (error) {
            set(state => {
                const queryToTab = { ...state.queryToTab }
                const queryAppends = { ...state.queryAppends }
                delete queryToTab[queryId]
                delete queryAppends[queryId]
                const current = state.queries[tabId]
                const failure: QuerySummary = { queryId, rowsAffected: 0, rowsReturned: offset, durationMs: 0, truncated: false, error: String(error), resultIndex, statement, final: true }
                const resultSets = current.resultSets.map(result => result.index === resultIndex ? { ...result, summary: failure } : result)
                return {
                    queryToTab,
                    queryAppends,
                    queries: {
                        ...state.queries,
                        [tabId]: { ...current, running: false, queryId: null, summary: failure, resultSets },
                    },
                }
            })
        }
    },

    cancelQuery: async (tabId) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const q = get().queries[tabId]
        if (!tab || !q?.queryId || !q.running) return
        await CancelQuery(tab.connId, q.queryId).catch(() => {})
    },

    beginTransaction: async (tabId) => {
        const tab = get().tabs.find(tab => tab.id === tabId)
        const query = get().queries[tabId]
        if (!tab || !query || query.running || query.transactionActive) return
        set(s => ({ queries: { ...s.queries, [tabId]: { ...query, transactionBusy: true } } }))
        try {
            await BeginTransaction(tab.connId, tab.id)
            set(s => ({ queries: { ...s.queries, [tabId]: { ...s.queries[tabId], transactionActive: true, transactionBusy: false } } }))
        } catch (err) {
            set(s => ({ queries: { ...s.queries, [tabId]: { ...s.queries[tabId], transactionBusy: false } }, lastError: String(err) }))
        }
    },

    commitTransaction: async (tabId) => {
        const tab = get().tabs.find(tab => tab.id === tabId)
        const query = get().queries[tabId]
        if (!tab || !query?.transactionActive || query.running) return
        set(s => ({ queries: { ...s.queries, [tabId]: { ...query, transactionBusy: true } } }))
        try {
            await CommitTransaction(tab.connId, tab.id)
            set(s => ({ queries: { ...s.queries, [tabId]: { ...s.queries[tabId], transactionActive: false, transactionBusy: false } } }))
        } catch (err) {
            set(s => ({ queries: { ...s.queries, [tabId]: { ...s.queries[tabId], transactionBusy: false } }, lastError: String(err) }))
        }
    },

    rollbackTransaction: async (tabId) => {
        const tab = get().tabs.find(tab => tab.id === tabId)
        const query = get().queries[tabId]
        if (!tab || !query?.transactionActive || query.running) return
        set(s => ({ queries: { ...s.queries, [tabId]: { ...query, transactionBusy: true } } }))
        try {
            await RollbackTransaction(tab.connId, tab.id)
            set(s => ({ queries: { ...s.queries, [tabId]: { ...s.queries[tabId], transactionActive: false, transactionBusy: false } } }))
        } catch (err) {
            set(s => ({ queries: { ...s.queries, [tabId]: { ...s.queries[tabId], transactionBusy: false } }, lastError: String(err) }))
        }
    },

    setActiveResult: (tabId, index) => {
        set(s => ({ queries: { ...s.queries, [tabId]: { ...s.queries[tabId], activeResultIndex: index } } }))
    },

    replaceQueryResultRows: (tabId, index, rows) => {
        set(s => {
            const query = s.queries[tabId]
            if (!query) return {}
            return {
                queries: {
                    ...s.queries,
                    [tabId]: {
                        ...query,
                        rows: index === 0 ? rows : query.rows,
                        resultSets: query.resultSets.map(result => result.index === index ? { ...result, rows } : result),
                    },
                },
            }
        })
    },

    applyBatch: (batch) => {
        const tabId = get().queryToTab[batch.queryId]
        if (!tabId) return
        set(s => {
            const q = s.queries[tabId]
            if (!q || q.queryId !== batch.queryId) return s
            const index = batch.resultIndex ?? 0
            const existing = q.resultSets.find(result => result.index === index) ?? {
                index,
                statement: '',
                columns: [],
                rows: [],
                summary: null,
            }
            const result = {
                ...existing,
                columns: batch.columns?.length ? batch.columns : existing.columns,
                rows: batch.rows?.length ? [...existing.rows, ...batch.rows] : existing.rows,
            }
            const resultSets = [...q.resultSets.filter(item => item.index !== index), result].sort((a, b) => a.index - b.index)
            return {
                queries: {
                    ...s.queries,
                    [tabId]: {
                        ...q,
                        columns: batch.columns?.length ? batch.columns : q.columns,
                        rows: index === 0 && batch.rows?.length ? [...q.rows, ...batch.rows] : q.rows,
                        resultSets,
                        activeResultIndex: index,
                    },
                },
            }
        })
    },

    applyDone: (summary) => {
        const tabId = get().queryToTab[summary.queryId]
        if (!tabId) return
        const connId = get().tabs.find(t => t.id === tabId)?.connId
        set(s => {
            const queryToTab = { ...s.queryToTab }
            const queryAppends = { ...s.queryAppends }
            const appending = !!queryAppends[summary.queryId]
            if (summary.final !== false) delete queryToTab[summary.queryId]
            if (summary.final !== false) delete queryAppends[summary.queryId]
            const q = s.queries[tabId]
            if (!q || q.queryId !== summary.queryId) return { ...s, queryToTab, queryAppends }
            const index = summary.resultIndex ?? 0
            const existing = q.resultSets.find(result => result.index === index) ?? {
                index,
                statement: '',
                columns: [],
                rows: [],
                summary: null,
            }
            const completedSummary = appending ? { ...summary, rowsReturned: existing.rows.length } : summary
            const resultSets = [
                ...q.resultSets.filter(result => result.index !== index),
                { ...existing, statement: summary.statement ?? existing.statement, summary: completedSummary },
            ].sort((a, b) => a.index - b.index)
            return {
                queryToTab,
                queryAppends,
                queries: {
                    ...s.queries,
                    [tabId]: {
                        ...q,
                        running: summary.final === false,
                        summary: completedSummary,
                        resultSets,
                        activeResultIndex: index,
                    },
                },
            }
        })
        if (connId) {
            if (summary.error) get().markMaybeDisconnected(connId, summary.error)
            else get().markAlive(connId)
        }
    },

    reloadTable: async (tabId, recount, refreshInfo) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().tableViews[tabId]
        if (!tab || tab.kind !== 'table' || !view) return
        setView(set, tabId, { loading: true, error: null })
        const req = drivers.PageRequest.createFrom({
            schema: tab.schema,
            table: tab.table,
            whereRaw: view.whereRaw,
            sorts: view.sorts,
            filters: view.filters,
            limit: settingsPageSize(),
            offset: view.page * settingsPageSize(),
        })
        try {
            let info = view.info
            if (!info || refreshInfo) {
                info = await OpenTable(tab.connId, tab.schema!, tab.table!)
            }
            const page = await LoadTableRows(tab.connId, req)
            get().markAlive(tab.connId)
            const rows = (page.rows ?? []) as unknown as Value[][]
            setView(set, tabId, {
                info,
                columns: page.columns ?? [],
                rows,
                baseRows: rows,
                hasMore: page.hasMore,
                loading: false,
                // Reloading from the server discards local edits.
                edits: [],
                undoStack: [],
                redoStack: [],
                previews: [],
                conflicts: [],
            })
            // Recount when the filter set changed (not on every page turn).
            if (recount) {
                CountTableRows(tab.connId, req)
                    .then(total => setView(set, tabId, { total }))
                    .catch(() => setView(set, tabId, { total: null }))
            }
        } catch (err) {
            setView(set, tabId, { loading: false, error: String(err) })
            get().markMaybeDisconnected(tab.connId, err)
        }
    },

    setTableWhere: async (tabId, whereRaw) => {
        setView(set, tabId, { whereRaw, page: 0 })
        await get().reloadTable(tabId, true)
    },

    setColWidth: (tabId, column, width) => {
        const view = get().tableViews[tabId]
        if (!view) return
        setView(set, tabId, { colWidths: { ...view.colWidths, [column]: width } })
    },

    setColumnVisible: (tabId, column, visible) => {
        const view = get().tableViews[tabId]
        if (!view) return
        const hidden = new Set(view.hiddenColumns)
        if (visible) hidden.delete(column)
        else hidden.add(column)
        setView(set, tabId, { hiddenColumns: [...hidden] })
    },

    showAllColumns: tabId => setView(set, tabId, { hiddenColumns: [] }),

    setTableSort: async (tabId, column) => {
        const view = get().tableViews[tabId]
        if (!view) return
        const current = view.sorts[0]
        // Cycle: none → asc → desc → none for the clicked column.
        let sorts: drivers.SortSpec[]
        if (!current || current.column !== column) {
            sorts = [drivers.SortSpec.createFrom({ column, desc: false })]
        } else if (!current.desc) {
            sorts = [drivers.SortSpec.createFrom({ column, desc: true })]
        } else {
            sorts = []
        }
        setView(set, tabId, { sorts, page: 0 })
        await get().reloadTable(tabId)
    },

    setTableFilters: async (tabId, filters) => {
        setView(set, tabId, { filters, page: 0 })
        await get().reloadTable(tabId, true)
    },

    setTablePage: async (tabId, page) => {
        if (page < 0) return
        setView(set, tabId, { page })
        await get().reloadTable(tabId)
    },

    stageEdit: (tabId, rowIndex, column, text, isNull) => get().stageEditBatch(tabId, [{ rowIndex, column, text, isNull }]),

    stageEditBatch: (tabId, changes) => {
        const view = get().tableViews[tabId]
        if (!view || !changes.length) return
        let rows = view.rows
        let edits = view.edits
        for (const { rowIndex, column, text, isNull } of changes) {
            if (edits.some(edit => edit.kind === 'delete' && edit.rowIndex === rowIndex)) continue
            const columnIndex = view.columns.findIndex(item => item.name === column)
            const currentCell = cellText(rows[rowIndex]?.[columnIndex])
            if (currentCell.null === isNull && currentCell.text === text) continue
            rows = rows.map((row, index) => index === rowIndex ? row.map((cell, columnIndex) => view.columns[columnIndex]?.name === column ? ({ t: isNull ? 'null' : 'str', v: isNull ? undefined : text } as Value) : cell) : row)
            edits = mergeEdit({ ...view, rows, edits }, rowIndex, column, text, isNull)
        }
        commitTableEdit(set, tabId, view, rows, edits)
        refreshPreview(get, tabId)
    },

    stageInsert: (tabId) => {
        const view = get().tableViews[tabId]
        if (!view) return
        const blank: Value[] = view.columns.map(() => ({ t: 'null' }) as Value)
        const rowIndex = view.rows.length
        commitTableEdit(set, tabId, view, [...view.rows, blank], [...view.edits, { kind: 'insert', key: {}, set: {}, rowIndex }])
        refreshPreview(get, tabId)
    },

    stageDuplicate: (tabId, rowIndex) => {
        const view = get().tableViews[tabId]
        if (!view?.info || !view.rows[rowIndex]) return
        const primaryKey = new Set(view.info.primaryKey ?? [])
        const row = view.rows[rowIndex].map(cell => ({ ...cell }))
        const setValues: PendingEdit['set'] = {}
        view.columns.forEach((column, index) => {
            if (primaryKey.has(column.name)) {
                row[index] = { t: 'null' }
                return
            }
            setValues[column.name] = cellText(row[index])
        })
        const duplicateIndex = view.rows.length
        commitTableEdit(set, tabId, view, [...view.rows, row], [...view.edits, { kind: 'insert', key: {}, set: setValues, rowIndex: duplicateIndex }])
        refreshPreview(get, tabId)
    },

    stageDelete: (tabId, rowIndex) => get().stageDeleteBatch(tabId, [rowIndex]),

    stageDeleteBatch: (tabId, rowIndexes) => {
        const view = get().tableViews[tabId]
        if (!view?.info || !rowIndexes.length) return
        let rows = view.rows
        let edits = view.edits
        for (const rowIndex of [...new Set(rowIndexes)].sort((left, right) => right - left)) {
            const result = stageRowDelete({ ...view, rows, edits }, rowIndex)
            rows = result.rows
            edits = result.edits
        }
        commitTableEdit(set, tabId, view, rows, edits)
        refreshPreview(get, tabId)
    },

    undoTableEdit: tabId => {
        const view = get().tableViews[tabId]
        if (!view) return
        const result = stepEditHistory(view.rows, view.edits, view.undoStack, view.redoStack)
        if (!result) return
        setView(set, tabId, { rows: result.rows, edits: result.edits, undoStack: result.from, redoStack: result.to, conflicts: [] })
        refreshPreview(get, tabId)
    },

    redoTableEdit: tabId => {
        const view = get().tableViews[tabId]
        if (!view) return
        const result = stepEditHistory(view.rows, view.edits, view.redoStack, view.undoStack)
        if (!result) return
        setView(set, tabId, { rows: result.rows, edits: result.edits, redoStack: result.from, undoStack: result.to, conflicts: [] })
        refreshPreview(get, tabId)
    },

    revertTableEdit: (tabId, editIndex, column) => {
        const view = get().tableViews[tabId]
        if (!view) return
        const result = revertPendingChange(view.rows, view.baseRows, view.columns.map(item => item.name), view.edits, editIndex, column)
        commitTableEdit(set, tabId, view, result.rows, result.edits)
        refreshPreview(get, tabId)
    },

    discardEdits: async (tabId) => {
        await get().reloadTable(tabId)
    },

    applyEdits: async (tabId, force = false) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().tableViews[tabId]
        if (!tab || !view || view.edits.length === 0) return
        try {
            const result = await ApplyChangeset(tab.connId, changesetOf(tab, view, force))
            if (result.conflicts?.length) {
                setView(set, tabId, { conflicts: result.conflicts, error: null })
                return
            }
            await get().reloadTable(tabId)
        } catch (err) {
            setView(set, tabId, { error: String(err) })
        }
    },

    dismissEditConflicts: tabId => setView(set, tabId, { conflicts: [] }),

    redisScan: async (tabId, reset) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().redisViews[tabId]
        if (!tab || !view) return
        setRedis(set, tabId, { loading: true, error: null })
        try {
            const cursor = reset ? 0 : view.cursor
            const res = await RedisScan(
                tab.connId,
                drivers.ScanRequest.createFrom({
                    db: view.db,
                    pattern: view.pattern,
                    typeFilter: view.typeFilter,
                    cursor,
                    count: 200,
                }),
            )
            const keys = res.keys ?? []
            get().markAlive(tab.connId)
            setRedis(set, tabId, {
                keys: reset ? keys : [...view.keys, ...keys],
                cursor: res.cursor,
                hasMore: res.cursor !== 0,
                loading: false,
            })
        } catch (err) {
            setRedis(set, tabId, { loading: false, error: String(err) })
            get().markMaybeDisconnected(tab.connId, err)
        }
    },

    redisSetDb: async (tabId, db) => {
        setRedis(set, tabId, { db, keys: [], cursor: 0, selectedKey: null, value: null })
        await get().redisScan(tabId, true)
    },

    redisSetPattern: (tabId, pattern, typeFilter) => {
        setRedis(set, tabId, { pattern, typeFilter })
    },

    redisSelectKey: async (tabId, key) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().redisViews[tabId]
        if (!tab || !view) return
        setRedis(set, tabId, { selectedKey: key, value: null })
        try {
            const value = await RedisGet(tab.connId, view.db, key)
            setRedis(set, tabId, { value })
        } catch (err) {
            setRedis(set, tabId, { error: String(err) })
        }
    },

    redisSaveString: async (tabId, value) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().redisViews[tabId]
        if (!tab || !view || !view.selectedKey) return
        try {
            await RedisSetString(tab.connId, view.db, view.selectedKey, value)
            await get().redisSelectKey(tabId, view.selectedKey)
        } catch (err) {
            setRedis(set, tabId, { error: String(err) })
        }
    },

    redisSaveTTL: async (tabId, seconds) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().redisViews[tabId]
        if (!tab || !view || !view.selectedKey) return
        try {
            await RedisSetTTL(tab.connId, view.db, view.selectedKey, seconds)
            await get().redisSelectKey(tabId, view.selectedKey)
        } catch (err) {
            setRedis(set, tabId, { error: String(err) })
        }
    },

    redisDeleteKey: async (tabId, key) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().redisViews[tabId]
        if (!tab || !view) return
        try {
            await RedisDelete(tab.connId, view.db, key)
            setRedis(set, tabId, {
                keys: view.keys.filter(k => k.key !== key),
                selectedKey: view.selectedKey === key ? null : view.selectedKey,
                value: view.selectedKey === key ? null : view.value,
            })
        } catch (err) {
            setRedis(set, tabId, { error: String(err) })
        }
    },

    redisRunCommand: async (tabId, command) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().redisViews[tabId]
        if (!tab || !view || !command.trim()) return
        try {
            const reply = await RedisCommand(tab.connId, view.db, command)
            const line: ReplLine = {
                command,
                text: reply.error ? reply.error : reply.text,
                error: !!reply.error,
            }
            setRedis(set, tabId, { repl: [...view.repl, line] })
        } catch (err) {
            setRedis(set, tabId, { repl: [...view.repl, { command, text: String(err), error: true }] })
        }
    },

    loadHistory: async (search) => {
        const entries = await ListHistory('', search, 200)
        set({ history: entries ?? [] })
    },

    toggleHistory: (open) => {
        set({ historyOpen: open })
        if (open) get().loadHistory('')
    },

    markMaybeDisconnected: (connId, err) => {
        if (looksDisconnected(String(err))) {
            set(s => ({ connected: { ...s.connected, [connId]: false } }))
        }
    },

    markAlive: (connId) => {
        set(s => (s.connected[connId] === false ? { connected: { ...s.connected, [connId]: true } } : {}))
    },

    setError: (msg) => set({ lastError: msg }),
}))

// --- Table view helpers -------------------------------------------------

function setView(
    set: (fn: (s: AppState) => Partial<AppState>) => void,
    tabId: string,
    patch: Partial<TableView>,
) {
    set(s => {
        const view = s.tableViews[tabId]
        if (!view) return {}
        return { tableViews: { ...s.tableViews, [tabId]: { ...view, ...patch } } }
    })
}

function setRedis(
    set: (fn: (s: AppState) => Partial<AppState>) => void,
    tabId: string,
    patch: Partial<RedisView>,
) {
    set(s => {
        const view = s.redisViews[tabId]
        if (!view) return {}
        return { redisViews: { ...s.redisViews, [tabId]: { ...view, ...patch } } }
    })
}

function cellText(cell: Value | undefined): { null: boolean; text: string } {
    if (!cell || cell.t === 'null') return { null: true, text: '' }
    return { null: false, text: String(cell.v ?? '') }
}

function pkOf(view: TableView, rowIndex: number): Record<string, string> | null {
    if (!view.info || view.info.primaryKey.length === 0) return null
    const key: Record<string, string> = {}
    for (const col of view.info.primaryKey) {
        const ci = view.columns.findIndex(c => c.name === col)
        if (ci < 0) return null
        key[col] = cellText(view.baseRows[rowIndex]?.[ci] ?? view.rows[rowIndex]?.[ci]).text
    }
    return key
}

function sameKey(a: Record<string, string>, b: Record<string, string>): boolean {
    const ak = Object.keys(a)
    if (ak.length !== Object.keys(b).length) return false
    return ak.every(k => a[k] === b[k])
}

function commitTableEdit(
    set: (fn: (state: AppState) => Partial<AppState>) => void,
    tabId: string,
    view: TableView,
    rows: Value[][],
    edits: PendingEdit[],
) {
    if (rows === view.rows && edits === view.edits) return
    setView(set, tabId, {
        rows,
        edits,
        undoStack: pushEditSnapshot(view.undoStack, view.rows, view.edits),
        redoStack: [],
        conflicts: [],
    })
}

function stageRowDelete(view: TableView, rowIndex: number): Pick<TableView, 'rows' | 'edits'> {
    const insertHere = view.edits.find(edit => edit.kind === 'insert' && edit.rowIndex === rowIndex)
    if (insertHere) {
        const rows = view.rows.filter((_, index) => index !== rowIndex)
        const edits = view.edits.filter(edit => edit !== insertHere).map(edit => edit.rowIndex > rowIndex ? { ...edit, rowIndex: edit.rowIndex - 1 } : edit)
        return { rows, edits }
    }
    const key = pkOf(view, rowIndex)
    if (!key || view.edits.some(edit => edit.kind === 'delete' && sameKey(edit.key, key))) return { rows: view.rows, edits: view.edits }
    const previousUpdate = view.edits.find(edit => edit.kind === 'update' && sameKey(edit.key, key))
    return {
        rows: view.rows,
        edits: [
            ...view.edits.filter(edit => !(edit.kind !== 'insert' && sameKey(edit.key, key))),
            { kind: 'delete', key, set: previousUpdate?.set ?? {}, rowIndex },
        ],
    }
}

// mergeEdit folds a cell change into the pending-edit list: it updates an
// existing insert/update for the same row, or creates a new update.
function mergeEdit(
    view: TableView,
    rowIndex: number,
    column: string,
    text: string,
    isNull: boolean,
): PendingEdit[] {
    const cell = { null: isNull, text }
    const insertHere = view.edits.find(e => e.kind === 'insert' && e.rowIndex === rowIndex)
    if (insertHere) {
        const set = { ...insertHere.set }
        if (cell.null) delete set[column]
        else set[column] = cell
        return view.edits.map(e =>
            e === insertHere ? { ...e, set } : e,
        )
    }
    const key = pkOf(view, rowIndex)
    if (!key) return view.edits // no PK: not editable
    const existing = view.edits.find(e => e.kind === 'update' && sameKey(e.key, key))
    const columnIndex = view.columns.findIndex(item => item.name === column)
    const original = cellText(view.baseRows[rowIndex]?.[columnIndex])
    const matchesOriginal = original.null === cell.null && original.text === cell.text
    if (existing) {
        const nextSet = { ...existing.set }
        if (matchesOriginal) delete nextSet[column]
        else nextSet[column] = cell
        return Object.keys(nextSet).length ? view.edits.map(e => e === existing ? { ...e, set: nextSet } : e) : view.edits.filter(e => e !== existing)
    }
    if (matchesOriginal) return view.edits
    return [...view.edits, { kind: 'update', key, set: { [column]: cell }, rowIndex }]
}

function changesetOf(tab: Tab, view: TableView, force = false): drivers.ChangesetRequest {
    const changes = view.edits.map(e =>
        drivers.RowChange.createFrom({
            kind: e.kind,
            key: Object.fromEntries(Object.entries(e.key).map(([k, v]) => [k, { null: false, text: v }])),
            set: e.set,
            original: originalValuesOf(view, e),
        }),
    )
    return drivers.ChangesetRequest.createFrom({ schema: tab.schema, table: tab.table, changes, force })
}

const unsafeOriginalType = /json|blob|binary|bytea|geometry|geography|xml|image/i

function originalValuesOf(view: TableView, edit: PendingEdit): Record<string, { null: boolean; text: string }> {
    if (edit.kind === 'insert' || edit.rowIndex < 0) return {}
    const row = view.baseRows[edit.rowIndex]
    if (!row) return {}
    return Object.fromEntries(view.columns.flatMap((column, index) => {
        const cell = row[index]
        if (!cell) return []
        if (cell.t !== 'null' && (cell.ref || unsafeOriginalType.test(column.typeName))) return []
        return [[column.name, cellText(cell)]]
    }))
}

function refreshPreview(get: () => AppState, tabId: string) {
    const tab = get().tabs.find(t => t.id === tabId)
    const view = get().tableViews[tabId]
    if (!tab || !view) return
    if (view.edits.length === 0) {
        useApp.setState(s => ({
            tableViews: { ...s.tableViews, [tabId]: { ...s.tableViews[tabId], previews: [] } },
        }))
        return
    }
    const requestedEdits = view.edits
    PreviewChangeset(tab.connId, changesetOf(tab, view))
        .then(previews =>
            useApp.setState(s => {
                const v = s.tableViews[tabId]
                if (!v || v.edits !== requestedEdits) return {}
                return { tableViews: { ...s.tableViews, [tabId]: { ...v, previews: previews ?? [] } } }
            }),
        )
        .catch(() => {})
}
