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
    LoadTableRows,
    OpenTable,
    PreviewChangeset,
    RunQuery,
} from '../wailsjs/go/api/App'
import { drivers } from '../wailsjs/go/models'
import { meta } from '../wailsjs/go/models'
import type { Column, QuerySummary, RowBatch, Value } from './ipc/types'

export const PAGE_SIZE = 200

// Default page cap (design §4): beyond this the UI should switch to
// explicit paging rather than accumulate unbounded rows in the webview.
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
    kind: 'query' | 'table'
    sql: string
    // Table tabs only:
    schema?: string
    table?: string
}

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
    page: number
    hasMore: boolean
    loading: boolean
    error: string | null
    edits: PendingEdit[]
    previews: string[]
}

const emptyTableView = (): TableView => ({
    info: null,
    columns: [],
    rows: [],
    sorts: [],
    filters: [],
    page: 0,
    hasMore: false,
    loading: false,
    error: null,
    edits: [],
    previews: [],
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
    history: meta.HistoryEntry[]
    historyOpen: boolean
    lastError: string | null

    loadConnections: () => Promise<void>
    connect: (connId: string) => Promise<void>
    disconnect: (connId: string) => Promise<void>
    removeConnection: (connId: string) => Promise<void>
    openDialog: (editing?: drivers.ConnectionConfig) => void
    closeDialog: () => void
    openQueryTab: (connId: string) => void
    openTableTab: (connId: string, schema: string, table: string) => Promise<void>
    closeTab: (tabId: string) => void
    setActiveTab: (tabId: string) => void
    setTabSql: (tabId: string, sql: string) => void
    runQuery: (tabId: string, statement: string) => Promise<void>
    cancelQuery: (tabId: string) => Promise<void>
    applyBatch: (batch: RowBatch) => void
    applyDone: (summary: QuerySummary) => void
    // Table view actions:
    reloadTable: (tabId: string) => Promise<void>
    setTableSort: (tabId: string, column: string) => Promise<void>
    setTableFilters: (tabId: string, filters: drivers.FilterSpec[]) => Promise<void>
    setTablePage: (tabId: string, page: number) => Promise<void>
    stageEdit: (tabId: string, rowIndex: number, column: string, text: string, isNull: boolean) => void
    stageInsert: (tabId: string) => void
    stageDelete: (tabId: string, rowIndex: number) => void
    discardEdits: (tabId: string) => void
    applyEdits: (tabId: string) => Promise<void>
    // History actions:
    loadHistory: (search: string) => Promise<void>
    toggleHistory: (open: boolean) => void
    setError: (msg: string | null) => void
}

export const useApp = create<AppState>((set, get) => ({
    connections: [],
    connected: {},
    connecting: {},
    autocomplete: {},
    tableViews: {},
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
        await get().reloadTable(tab.id)
    },

    closeTab: (tabId) => {
        set(s => {
            const tabs = s.tabs.filter(t => t.id !== tabId)
            const queries = { ...s.queries }
            const tableViews = { ...s.tableViews }
            delete queries[tabId]
            delete tableViews[tabId]
            return {
                tabs,
                queries,
                tableViews,
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
            await RunQuery(tab.connId, queryId, statement, MAX_ROWS)
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
    },

    reloadTable: async (tabId) => {
        const tab = get().tabs.find(t => t.id === tabId)
        const view = get().tableViews[tabId]
        if (!tab || tab.kind !== 'table' || !view) return
        setView(set, tabId, { loading: true, error: null })
        try {
            let info = view.info
            if (!info) {
                info = await OpenTable(tab.connId, tab.schema!, tab.table!)
            }
            const page = await LoadTableRows(
                tab.connId,
                drivers.PageRequest.createFrom({
                    schema: tab.schema,
                    table: tab.table,
                    sorts: view.sorts,
                    filters: view.filters,
                    limit: PAGE_SIZE,
                    offset: view.page * PAGE_SIZE,
                }),
            )
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
        } catch (err) {
            setView(set, tabId, { loading: false, error: String(err) })
        }
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
        await get().reloadTable(tabId)
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

    loadHistory: async (search) => {
        const entries = await ListHistory('', search, 200)
        set({ history: entries ?? [] })
    },

    toggleHistory: (open) => {
        set({ historyOpen: open })
        if (open) get().loadHistory('')
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
