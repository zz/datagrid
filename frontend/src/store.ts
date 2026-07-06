import { create } from 'zustand'
import {
    ApplyChangeset,
    CancelQuery,
    Connect,
    DeleteConnection,
    Disconnect,
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
    SaveConnection,
    SwitchDatabase,
    RunQuery,
} from '../wailsjs/go/api/App'
import { drivers } from '../wailsjs/go/models'
import { meta } from '../wailsjs/go/models'
import type { Column, QuerySummary, RowBatch, Value } from './ipc/types'
import { pageSize as settingsPageSize, rowLimit as settingsRowLimit } from './settings'

// Fallback defaults; the effective values come from the settings store.
export const PAGE_SIZE = 200
export const MAX_ROWS = 10_000

export interface QueryState {
    queryId: string | null
    running: boolean
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
    sorts: drivers.SortSpec[]
    filters: drivers.FilterSpec[]
    whereRaw: string
    total: number | null // total matching rows; null until counted
    page: number
    hasMore: boolean
    loading: boolean
    error: string | null
    edits: PendingEdit[]
    previews: string[]
    colWidths: Record<string, number>
}

const emptyTableView = (): TableView => ({
    info: null,
    columns: [],
    rows: [],
    sorts: [],
    filters: [],
    whereRaw: '',
    total: null,
    page: 0,
    hasMore: false,
    loading: false,
    error: null,
    edits: [],
    previews: [],
    colWidths: {},
})

const emptyQuery = (): QueryState => ({
    queryId: null,
    running: false,
    columns: [],
    rows: [],
    summary: null,
})

let nextId = 1
const genId = (prefix: string) => `${prefix}-${nextId++}-${Date.now().toString(36)}`

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
    renameGroup: (oldName: string, newName: string) => Promise<void>
    switchDatabase: (connId: string, database: string) => Promise<void>
    openDialog: (editing?: drivers.ConnectionConfig) => void
    closeDialog: () => void
    openQueryTab: (connId: string) => void
    openTableTab: (connId: string, schema: string, table: string) => Promise<void>
    openRedisTab: (connId: string, db: number) => Promise<void>
    closeTab: (tabId: string) => void
    setActiveTab: (tabId: string) => void
    setTabSql: (tabId: string, sql: string) => void
    runQuery: (tabId: string, statement: string) => Promise<void>
    cancelQuery: (tabId: string) => Promise<void>
    applyBatch: (batch: RowBatch) => void
    applyDone: (summary: QuerySummary) => void
    // Table view actions:
    reloadTable: (tabId: string, recount?: boolean) => Promise<void>
    setTableSort: (tabId: string, column: string) => Promise<void>
    setTableFilters: (tabId: string, filters: drivers.FilterSpec[]) => Promise<void>
    setTableWhere: (tabId: string, whereRaw: string) => Promise<void>
    setTablePage: (tabId: string, page: number) => Promise<void>
    setColWidth: (tabId: string, column: string, width: number) => void
    stageEdit: (tabId: string, rowIndex: number, column: string, text: string, isNull: boolean) => void
    stageInsert: (tabId: string) => void
    stageDelete: (tabId: string, rowIndex: number) => void
    discardEdits: (tabId: string) => void
    applyEdits: (tabId: string) => Promise<void>
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
    tabs: [],
    activeTabId: null,
    queries: {},
    queryToTab: {},
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

    openQueryTab: (connId) => {
        const conn = get().connections.find(c => c.id === connId)
        const tab: Tab = {
            id: genId('tab'),
            connId,
            title: conn ? conn.name : 'Query',
            kind: 'query',
            sql: '',
        }
        set(s => ({
            tabs: [...s.tabs, tab],
            activeTabId: tab.id,
            queries: { ...s.queries, [tab.id]: emptyQuery() },
        }))
    },

    openTableTab: async (connId, schema, table) => {
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
        }
        set(s => ({
            tabs: [...s.tabs, tab],
            activeTabId: tab.id,
            tableViews: { ...s.tableViews, [tab.id]: emptyTableView() },
        }))
        await get().reloadTable(tab.id, true)
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

    closeTab: (tabId) => {
        set(s => {
            const tabs = s.tabs.filter(t => t.id !== tabId)
            const queries = { ...s.queries }
            const tableViews = { ...s.tableViews }
            const redisViews = { ...s.redisViews }
            delete queries[tabId]
            delete tableViews[tabId]
            delete redisViews[tabId]
            return {
                tabs,
                queries,
                tableViews,
                redisViews,
                activeTabId:
                    s.activeTabId === tabId ? (tabs.length ? tabs[tabs.length - 1].id : null) : s.activeTabId,
            }
        })
    },

    setActiveTab: (tabId) => set({ activeTabId: tabId }),
    setTabSql: (tabId, sql) =>
        set(s => ({ tabs: s.tabs.map(t => (t.id === tabId ? { ...t, sql } : t)) })),

    runQuery: async (tabId, statement) => {
        const tab = get().tabs.find(t => t.id === tabId)
        if (!tab || !statement.trim()) return
        const queryId = genId('q')
        set(s => ({
            queries: { ...s.queries, [tabId]: { ...emptyQuery(), queryId, running: true } },
            queryToTab: { ...s.queryToTab, [queryId]: tabId },
        }))
        try {
            await RunQuery(tab.connId, queryId, statement, settingsRowLimit())
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

    cancelQuery: async (tabId) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const q = get().queries[tabId]
        if (!tab || !q?.queryId || !q.running) return
        await CancelQuery(tab.connId, q.queryId).catch(() => {})
    },

    applyBatch: (batch) => {
        const tabId = get().queryToTab[batch.queryId]
        if (!tabId) return
        set(s => {
            const q = s.queries[tabId]
            if (!q || q.queryId !== batch.queryId) return s
            return {
                queries: {
                    ...s.queries,
                    [tabId]: {
                        ...q,
                        columns: batch.columns?.length ? batch.columns : q.columns,
                        rows: batch.rows?.length ? [...q.rows, ...batch.rows] : q.rows,
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
            delete queryToTab[summary.queryId]
            const q = s.queries[tabId]
            if (!q || q.queryId !== summary.queryId) return { ...s, queryToTab }
            return {
                queryToTab,
                queries: { ...s.queries, [tabId]: { ...q, running: false, summary } },
            }
        })
        if (summary.error && connId) get().markMaybeDisconnected(connId, summary.error)
    },

    reloadTable: async (tabId, recount) => {
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
            if (!info) {
                info = await OpenTable(tab.connId, tab.schema!, tab.table!)
            }
            const page = await LoadTableRows(tab.connId, req)
            setView(set, tabId, {
                info,
                columns: page.columns ?? [],
                rows: (page.rows ?? []) as unknown as Value[][],
                hasMore: page.hasMore,
                loading: false,
                // Reloading from the server discards local edits.
                edits: [],
                previews: [],
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

    stageEdit: (tabId, rowIndex, column, text, isNull) => {
        const view = get().tableViews[tabId]
        if (!view) return
        const rows = view.rows.map((r, i) =>
            i === rowIndex
                ? r.map((c, ci) =>
                      view.columns[ci]?.name === column
                          ? ({ t: isNull ? 'null' : 'str', v: isNull ? undefined : text } as Value)
                          : c,
                  )
                : r,
        )
        const edits = mergeEdit(view, rowIndex, column, text, isNull)
        setView(set, tabId, { rows, edits })
        refreshPreview(get, tabId)
    },

    stageInsert: (tabId) => {
        const view = get().tableViews[tabId]
        if (!view) return
        const blank: Value[] = view.columns.map(() => ({ t: 'null' }) as Value)
        const rowIndex = view.rows.length
        setView(set, tabId, {
            rows: [...view.rows, blank],
            edits: [...view.edits, { kind: 'insert', key: {}, set: {}, rowIndex }],
        })
        refreshPreview(get, tabId)
    },

    stageDelete: (tabId, rowIndex) => {
        const view = get().tableViews[tabId]
        if (!view || !view.info) return
        // Removing a not-yet-inserted row just drops its insert edit.
        const insertHere = view.edits.find(e => e.kind === 'insert' && e.rowIndex === rowIndex)
        if (insertHere) {
            setView(set, tabId, { edits: view.edits.filter(e => e !== insertHere) })
            refreshPreview(get, tabId)
            return
        }
        const key = pkOf(view, rowIndex)
        if (!key) return
        const edits = [
            ...view.edits.filter(e => !(e.kind !== 'insert' && sameKey(e.key, key))),
            { kind: 'delete' as const, key, set: {}, rowIndex },
        ]
        setView(set, tabId, { edits })
        refreshPreview(get, tabId)
    },

    discardEdits: async (tabId) => {
        await get().reloadTable(tabId)
    },

    applyEdits: async (tabId) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().tableViews[tabId]
        if (!tab || !view || view.edits.length === 0) return
        try {
            await ApplyChangeset(tab.connId, changesetOf(tab, view))
            await get().reloadTable(tabId)
        } catch (err) {
            setView(set, tabId, { error: String(err) })
        }
    },

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
        key[col] = cellText(view.rows[rowIndex]?.[ci]).text
    }
    return key
}

function sameKey(a: Record<string, string>, b: Record<string, string>): boolean {
    const ak = Object.keys(a)
    if (ak.length !== Object.keys(b).length) return false
    return ak.every(k => a[k] === b[k])
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
        return view.edits.map(e =>
            e === insertHere ? { ...e, set: { ...e.set, [column]: cell } } : e,
        )
    }
    const key = pkOf(view, rowIndex)
    if (!key) return view.edits // no PK: not editable
    const existing = view.edits.find(e => e.kind === 'update' && sameKey(e.key, key))
    if (existing) {
        return view.edits.map(e =>
            e === existing ? { ...e, set: { ...e.set, [column]: cell } } : e,
        )
    }
    return [...view.edits, { kind: 'update', key, set: { [column]: cell }, rowIndex }]
}

function changesetOf(tab: Tab, view: TableView): drivers.ChangesetRequest {
    const changes = view.edits.map(e =>
        drivers.RowChange.createFrom({
            kind: e.kind,
            key: Object.fromEntries(Object.entries(e.key).map(([k, v]) => [k, { null: false, text: v }])),
            set: e.set,
        }),
    )
    return drivers.ChangesetRequest.createFrom({ schema: tab.schema, table: tab.table, changes })
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
    PreviewChangeset(tab.connId, changesetOf(tab, view))
        .then(previews =>
            useApp.setState(s => {
                const v = s.tableViews[tabId]
                if (!v) return {}
                return { tableViews: { ...s.tableViews, [tabId]: { ...v, previews: previews ?? [] } } }
            }),
        )
        .catch(() => {})
}
