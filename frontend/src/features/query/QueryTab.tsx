import { useCallback, useEffect, useRef, useState } from 'react'
import SqlEditor from '../../components/SqlEditor'
import ResultExplorer from './ResultExplorer'
import PlanTree from '../../components/PlanTree'
import { AnalyzeQuery, CancelQuery as CancelFacetQuery, ExplainQuery, OpenSQLScratch, QueryResultFacet, SaveSQLScratch, ServerDatabases } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp, Tab } from '../../store'
import { useSettings } from '../../settings'
import CopyButton from '../../components/CopyButton'
import { Activity, Bookmark, BookOpen, Check, Clock3, FileDown, FileUp, Gauge, GitBranch, GitCompare, Pin, RotateCcw, Save, Trash2, WandSparkles } from 'lucide-react'
import QueryParametersDialog from './QueryParametersDialog'
import { queryParameterNames } from './queryParameters'
import { expandWildcards, qualifySelectColumns } from './sqlIntentions'
import { BUILTIN_SNIPPETS, loadSQLSnippets, saveSQLSnippets, snippetTrigger, SQLSnippet } from './sqlSnippets'
import NameDialog from '../../components/NameDialog'
import { linePreview, loadSQLBookmarks, saveSQLBookmarks } from './sqlBookmarks'
import { ResultSnapshot } from './resultComparison'
import { deleteResultSnapshot, loadResultSnapshots, saveResultSnapshot } from './resultSnapshots'
import PlanComparisonView from './PlanComparisonView'
import { PlanSnapshot } from './planComparison'
import QueryBenchmarkDialog from './QueryBenchmarkDialog'
import ConsoleLocalHistoryDialog from './ConsoleLocalHistoryDialog'
import { ConsoleRevision, saveConsoleRevision } from './consoleLocalHistory'
import SchemaContextControl from './SchemaContextControl'
import { loadConsoleSchemaContext, normalizeSchemaContext, saveConsoleSchemaContext, schemaNames } from './consoleSchemaContext'
import ExecutionSettingsControl from './ExecutionSettingsControl'
import { isPageableResultStatement, loadQueryExecutionSettings, normalizeExecutionSettings, saveQueryExecutionSettings } from './queryExecutionSettings'
import { buildServerFacetStatement, buildServerResultCountStatement, buildServerResultStatement, canBuildServerResultView, RESULT_VIEW_MARKER } from './serverResultView'
import type { ResultFacetRequest, ResultFacetResult } from './serverResultView'
import { displayValue, type Value } from '../../ipc/types'

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
    const engine = conn?.engine ?? 'postgres'
    const schema = useApp(s => s.autocomplete[tab.connId])
    const {
        runQuery,
        runQueryView,
        fetchMoreQuery,
        cancelQuery,
        beginTransaction,
        commitTransaction,
        rollbackTransaction,
        setActiveResult,
        replaceQueryResultRows,
        setTabSql,
        setError,
        switchDatabase,
        openTableTab,
        openQueryTab,
    } = useApp()
    const [dirtyResultIndex, setDirtyResultIndex] = useState<number | null>(null)
    const serverBaseStatement = useRef('')
    const facetQueryId = useRef('')
    const countQueryId = useRef('')
    const handleResultDirty = useCallback((dirty: boolean) => setDirtyResultIndex(dirty ? (q?.activeResultIndex ?? null) : null), [q?.activeResultIndex])
    const handleResultRows = useCallback((nextRows: Value[][]) => {
        if (q) replaceQueryResultRows(tab.id, q.activeResultIndex, nextRows)
    }, [q, replaceQueryResultRows, tab.id])
    const MAX_ROWS = useSettings(s => s.rowLimit)
    const [confirm, setConfirm] = useState<{ statement: string; parameters: Record<string, string> } | null>(null)
    const [parameterRequest, setParameterRequest] = useState<{ statement: string; names: string[] } | null>(null)
    const [plan, setPlan] = useState<drivers.PlanNode | null>(null)
    const [planMode, setPlanMode] = useState<'estimate' | 'actual'>('estimate')
    const [planBusy, setPlanBusy] = useState(false)
    const [planStatement, setPlanStatement] = useState('')
    const [planSnapshots, setPlanSnapshots] = useState<PlanSnapshot[]>([])
    const [comparePlans, setComparePlans] = useState(false)
    const [benchmarkOpen, setBenchmarkOpen] = useState(false)
    const [databases, setDatabases] = useState<string[]>([])
    const [intentionsOpen, setIntentionsOpen] = useState(false)
    const intentionsRef = useRef<HTMLDivElement>(null)
    const [snippetsOpen, setSnippetsOpen] = useState(false)
    const snippetsRef = useRef<HTMLDivElement>(null)
    const [customSnippets, setCustomSnippets] = useState<SQLSnippet[]>(loadSQLSnippets)
    const [saveSnippet, setSaveSnippet] = useState(false)
    const [insertRequest, setInsertRequest] = useState<{ id: number; sql: string } | null>(null)
    const snippets = [...BUILTIN_SNIPPETS, ...customSnippets]
    const [cursorLine, setCursorLine] = useState(1)
    const [bookmarks, setBookmarks] = useState<number[]>(() => loadSQLBookmarks()[tab.id] ?? [])
    const [bookmarksOpen, setBookmarksOpen] = useState(false)
    const bookmarksRef = useRef<HTMLDivElement>(null)
    const [navigateRequest, setNavigateRequest] = useState<{ id: number; line: number } | null>(null)
    const [pinnedResults, setPinnedResults] = useState<ResultSnapshot[]>(loadResultSnapshots)
    const [formatRequest, setFormatRequest] = useState<{ id: number } | null>(null)
    const [localHistoryOpen, setLocalHistoryOpen] = useState(false)
    const schemaFallback = engine === 'mysql' ? [conn?.database ?? ''].filter(Boolean) : ['public']
    const [schemaContext, setSchemaContext] = useState<string[]>(() => loadConsoleSchemaContext(tab.id, schemaFallback))
    const [executionSettings, setExecutionSettings] = useState(() => loadQueryExecutionSettings(tab.id))
    const handleResultReload = useCallback(() => {
        const result = q?.resultSets.find(item => item.index === q.activeResultIndex)
        if (!result?.statement) return
        void runQuery(tab.id, result.statement, q.parameterValues, schemaContext, executionSettings.rowLimit || MAX_ROWS, executionSettings.timeoutSeconds * 1000)
    }, [MAX_ROWS, executionSettings.rowLimit, executionSettings.timeoutSeconds, q, runQuery, schemaContext, tab.id])

    useEffect(() => {
        const timer = setTimeout(() => saveConsoleRevision({ tabId: tab.id, title: tab.title, sql: tab.sql, reason: 'edit' }), 2500)
        return () => clearTimeout(timer)
    }, [tab.id, tab.sql, tab.title])

    // Fetch the server's databases for the active-database selector.
    useEffect(() => {
        if (conn && conn.engine !== 'redis') {
            ServerDatabases(tab.connId)
                .then(l => setDatabases(l ?? []))
                .catch(() => {})
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab.connId, conn?.engine, conn?.database])

    useEffect(() => {
        if (!intentionsOpen) return
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent && event.key === 'Escape') setIntentionsOpen(false)
            else if (event instanceof MouseEvent && !intentionsRef.current?.contains(event.target as Node)) setIntentionsOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', close)
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
    }, [intentionsOpen])

    useEffect(() => {
        if (!snippetsOpen) return
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent && event.key === 'Escape') setSnippetsOpen(false)
            else if (event instanceof MouseEvent && !snippetsRef.current?.contains(event.target as Node)) setSnippetsOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', close)
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
    }, [snippetsOpen])

    useEffect(() => {
        if (!bookmarksOpen) return
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent && event.key === 'Escape') setBookmarksOpen(false)
            else if (event instanceof MouseEvent && !bookmarksRef.current?.contains(event.target as Node)) setBookmarksOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', close)
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
    }, [bookmarksOpen])
    useEffect(() => () => {
        if (facetQueryId.current) void CancelFacetQuery(tab.connId, facetQueryId.current)
        if (countQueryId.current) void CancelFacetQuery(tab.connId, countQueryId.current)
    }, [tab.connId])

    if (!q) return null

    const activeResult = q.resultSets.find(result => result.index === q.activeResultIndex)
    const resultColumns = activeResult?.columns ?? q.columns
    const resultRows = activeResult?.rows ?? q.rows
    const activeStatement = activeResult?.statement ?? ''
    if (activeStatement && !activeStatement.includes(RESULT_VIEW_MARKER)) serverBaseStatement.current = activeStatement
    const loadServerFacet = async (request: ResultFacetRequest): Promise<ResultFacetResult> => {
        const base = serverBaseStatement.current || activeStatement
        const statement = buildServerFacetStatement(base, resultColumns, request.view, request.column, engine, request.search, 501)
        if (!statement) throw new Error('This column uses local distinct values.')
        const previous = facetQueryId.current
        if (previous) void CancelFacetQuery(tab.connId, previous)
        const queryId = `facet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        facetQueryId.current = queryId
        try {
            const page = await QueryResultFacet(tab.connId, queryId, statement, 501, q.transactionActive ? tab.id : '', q.parameterValues, schemaContext, executionSettings.timeoutSeconds * 1000)
            const values = (page.rows ?? []).slice(0, 500).flatMap(row => {
                const cell = row[0] as Value | undefined
                const countCell = row[1] as Value | undefined
                if (!cell || cell.ref || cell.t === 'bytes') return []
                const count = Number(countCell?.v ?? 0)
                const isNull = cell.t === 'null'
                return [{ value: isNull ? '' : displayValue(cell), isNull, count: Number.isFinite(count) ? count : 0 }]
            })
            return { values, limited: (page.rows?.length ?? 0) > 500 || page.hasMore }
        } finally {
            if (facetQueryId.current === queryId) facetQueryId.current = ''
        }
    }
    const loadResultCount = async (): Promise<number> => {
        const statement = buildServerResultCountStatement(activeStatement)
        if (!statement) throw new Error('This result cannot be counted.')
        const previous = countQueryId.current
        if (previous) void CancelFacetQuery(tab.connId, previous)
        const queryId = `count-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        countQueryId.current = queryId
        try {
            const timeoutMs = executionSettings.timeoutSeconds > 0 ? executionSettings.timeoutSeconds * 1000 : 10_000
            const page = await QueryResultFacet(tab.connId, queryId, statement, 1, q.transactionActive ? tab.id : '', q.parameterValues, schemaContext, timeoutMs)
            const count = Number((page.rows?.[0]?.[0] as Value | undefined)?.v)
            if (!Number.isFinite(count) || count < 0) throw new Error('The database returned an invalid result count.')
            return count
        } finally {
            if (countQueryId.current === queryId) countQueryId.current = ''
        }
    }

    // MySQL's "schema" is the database itself; Postgres defaults to public.
    const defaultSchema = schemaContext[0] ?? (engine === 'mysql' ? conn?.database : 'public')
    const updateSchemaContext = (schemas: string[]) => {
        const next = normalizeSchemaContext(engine, schemas)
        setSchemaContext(next)
        saveConsoleSchemaContext(tab.id, next)
    }
    const updateExecutionSettings = (settings: typeof executionSettings) => {
        const next = normalizeExecutionSettings(settings)
        setExecutionSettings(next)
        saveQueryExecutionSettings(tab.id, next)
    }

    const explain = async () => {
        if (!conn) return
        const statement = tab.sql.trim()
        if (!statement) return
        try {
            setPlanBusy(true)
            const p = await ExplainQuery(tab.connId, statement)
            setPlan(p)
            setPlanMode('estimate')
            setPlanStatement(statement)
            setComparePlans(false)
        } catch (err) {
            setError(String(err))
        } finally {
            setPlanBusy(false)
        }
    }

    const analyze = async () => {
        if (!conn) return
        const statement = tab.sql.trim()
        if (!statement) return
        try {
            setPlanBusy(true)
            const result = await AnalyzeQuery(tab.connId, statement)
            setPlan(result)
            setPlanMode('actual')
            setPlanStatement(statement)
            setComparePlans(false)
        } catch (err) {
            setError(String(err))
        } finally {
            setPlanBusy(false)
        }
    }

    const execute = (statement: string, parameters: Record<string, string>) => {
        if (dirtyResultIndex !== null) {
            setError('Apply or discard pending result edits before running another statement.')
            return
        }
        if (executionSettings.confirmDestructive && destructiveWithoutWhere(statement)) {
            setConfirm({ statement, parameters })
            return
        }
        saveConsoleRevision({ tabId: tab.id, title: tab.title, sql: tab.sql, reason: 'executed' })
        serverBaseStatement.current = statement
        runQuery(tab.id, statement, parameters, schemaContext, executionSettings.rowLimit || MAX_ROWS, executionSettings.timeoutSeconds * 1000)
    }

    const run = (stmt: string) => {
        if (!conn) return
        const statement = stmt || tab.sql
        const names = queryParameterNames(statement, engine)
        if (names.length > 0) {
            setParameterRequest({ statement, names })
            return
        }
        execute(statement, {})
    }

    const applyIntention = (transform: (sql: string, schema: Record<string, string[]>, defaultSchema: string) => string) => {
        const next = transform(tab.sql, schema ?? {}, defaultSchema ?? 'public')
        if (next !== tab.sql) setTabSql(tab.id, next)
        setIntentionsOpen(false)
    }
    const updateBookmarks = (next: number[]) => {
        const sorted = [...new Set(next)].sort((a, b) => a - b)
        setBookmarks(sorted)
        saveSQLBookmarks({ ...loadSQLBookmarks(), [tab.id]: sorted })
    }
    const openScratch = async () => {
        try {
            const file = await OpenSQLScratch()
            if (file) openQueryTab(tab.connId, file.content, file.name)
        } catch (error) { setError(String(error)) }
    }
    const saveScratch = async () => {
        try { await SaveSQLScratch(tab.title, tab.sql) }
        catch (error) { setError(String(error)) }
    }
    const pinPlan = () => {
        if (!plan) return
        const createdAt = Date.now()
        setPlanSnapshots(current => [...current, { id: `plan-${createdAt}`, label: new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), mode: planMode, statement: planStatement, createdAt, plan }])
    }

    const statusLine = () => {
        if (!conn) return 'Data source is missing'
        if (q.running) return `Running… ${q.rows.length.toLocaleString()} rows`
        const s = activeResult?.summary ?? q.summary
        if (!s) return 'Press ⌘⏎ to run'
        if (s.error) return `Error: ${s.error}`
        const rows =
            s.rowsReturned > 0
                ? `${s.rowsReturned.toLocaleString()} rows${s.truncated ? ' (row limit reached)' : ''}`
                : `${s.rowsAffected} affected`
        return `${rows} · ${s.durationMs} ms`
    }

    return (
        <div className="query-tab">
            <div className="query-toolbar">
                <button className="primary" disabled={q.running || !conn || dirtyResultIndex !== null} onClick={() => run(tab.sql)} title={dirtyResultIndex !== null ? 'Apply or discard pending result edits first' : 'Run (⌘⏎)'}>
                    ▶ Run
                </button>
                <select
                    className="db-select"
                    disabled={!conn || dirtyResultIndex !== null}
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
                <SchemaContextControl engine={engine} available={schemaNames(schema)} value={schemaContext} fallback={schemaFallback} onChange={updateSchemaContext} />
                <ExecutionSettingsControl value={executionSettings} globalRowLimit={MAX_ROWS} onChange={updateExecutionSettings} />
                <span className={`transaction-state ${q.transactionActive ? 'active' : ''}`}>
                    <GitBranch size={13} /> {q.transactionActive ? 'Manual transaction' : 'Auto-commit'}
                </span>
                {q.transactionActive ? (
                    <>
                        <button
                            disabled={q.running || q.transactionBusy}
                            onClick={() => commitTransaction(tab.id)}
                            title="Commit transaction"
                        >
                            <Check size={13} /> Commit
                        </button>
                        <button
                            disabled={q.running || q.transactionBusy}
                            onClick={() => rollbackTransaction(tab.id)}
                            title="Roll back transaction"
                        >
                            <RotateCcw size={13} /> Rollback
                        </button>
                    </>
                ) : (
                    <button
                        disabled={!conn || q.running || q.transactionBusy || dirtyResultIndex !== null}
                        onClick={() => beginTransaction(tab.id)}
                        title="Begin a manual transaction pinned to this console"
                    >
                        Begin
                    </button>
                )}
                {!conn && <span className="query-missing-source">Missing data source: {tab.connId}</span>}
                {conn?.readOnly && (
                    <span className="ro-chip" title="This connection is read-only; only SELECT-style statements will run.">
                        🔒 Read-only
                    </span>
                )}
                <button disabled={!q.running} onClick={() => cancelQuery(tab.id)}>
                    ■ Cancel
                </button>
                <button disabled={q.running || planBusy || !conn} onClick={explain} title="Show the estimated query plan">
                    ⋔ Explain
                </button>
                <button disabled={q.running || planBusy || !conn} onClick={analyze} title="Execute this read-only query and show actual plan metrics">
                    <Activity size={13} /> Analyze
                </button>
                <button disabled={q.running || !conn || !tab.sql.trim()} onClick={() => setBenchmarkOpen(true)} title="Benchmark repeated read-only execution">
                    <Gauge size={13} /> Benchmark
                </button>
                <button onClick={() => setFormatRequest({ id: Date.now() })} title="Format selection or document (Cmd/Ctrl+Alt+L)">
                    ✦ Format
                </button>
                <div className="query-intentions-wrap" ref={intentionsRef}>
                    <button onClick={() => setIntentionsOpen(open => !open)} title="SQL intentions"><WandSparkles size={13} /> Intentions</button>
                    {intentionsOpen && <div className="query-intentions-menu">
                        <button onClick={() => applyIntention(expandWildcards)}><strong>Expand wildcards</strong><span>Replace resolvable * expressions with columns</span></button>
                        <button onClick={() => applyIntention(qualifySelectColumns)}><strong>Qualify select columns</strong><span>Add the single source alias to simple columns</span></button>
                    </div>}
                </div>
                <div className="query-intentions-wrap" ref={snippetsRef}>
                    <button onClick={() => setSnippetsOpen(open => !open)} title="SQL snippets"><BookOpen size={13} /> Snippets</button>
                    {snippetsOpen && <div className="query-intentions-menu query-snippets-menu">
                        {snippets.map(snippet => <div className="query-snippet-row" key={snippet.id}>
                            <button onClick={() => { setInsertRequest({ id: Date.now(), sql: snippet.sql }); setSnippetsOpen(false) }}><strong>{snippet.name}</strong><span>{snippet.trigger} + Tab</span></button>
                            {!snippet.builtin && <button className="icon-btn" title="Delete snippet" onClick={() => {
                                const next = customSnippets.filter(item => item.id !== snippet.id)
                                setCustomSnippets(next)
                                saveSQLSnippets(next)
                            }}><Trash2 size={12} /></button>}
                        </div>)}
                        <div className="query-snippet-save"><button disabled={!tab.sql.trim()} onClick={() => { setSnippetsOpen(false); setSaveSnippet(true) }}><Save size={12} /> Save current SQL</button></div>
                    </div>}
                </div>
                <button className="icon-btn" onClick={() => void openScratch()} title="Open SQL scratch file"><FileUp size={14} /></button>
                <button className="icon-btn" onClick={() => void saveScratch()} title="Save SQL scratch file"><FileDown size={14} /></button>
                <div className="query-intentions-wrap" ref={bookmarksRef}>
                    <button onClick={() => setBookmarksOpen(open => !open)} title="SQL bookmarks"><Bookmark size={13} /> {bookmarks.length || ''}</button>
                    {bookmarksOpen && <div className="query-intentions-menu query-bookmarks-menu">
                        <button onClick={() => updateBookmarks(bookmarks.includes(cursorLine) ? bookmarks.filter(line => line !== cursorLine) : [...bookmarks, cursorLine])}><strong>{bookmarks.includes(cursorLine) ? 'Remove current bookmark' : 'Bookmark current line'}</strong><span>Line {cursorLine}</span></button>
                        {bookmarks.map(line => <div className="query-bookmark-row" key={line}>
                            <button onClick={() => { setNavigateRequest({ id: Date.now(), line }); setBookmarksOpen(false) }}><strong>Line {line}</strong><span>{linePreview(tab.sql, line)}</span></button>
                            <button className="icon-btn" onClick={() => updateBookmarks(bookmarks.filter(item => item !== line))} title="Remove bookmark"><Trash2 size={12} /></button>
                        </div>)}
                    </div>}
                </div>
                <button onClick={() => setLocalHistoryOpen(true)} title="Console local history"><Clock3 size={13} /> Local History</button>
                <span className={`query-status ${q.summary?.error ? 'error' : ''}`}>{statusLine()}</span>
                {q.summary?.error && <CopyButton text={q.summary.error} />}
            </div>
            <div className="query-editor">
                <SqlEditor
                    engine={engine}
                    schema={schema}
                    defaultSchema={defaultSchema}
                    value={tab.sql}
                    onChange={sql => setTabSql(tab.id, sql)}
                    onRun={run}
                    onOpenTable={(schemaName, tableName) => openTableTab(tab.connId, schemaName, tableName)}
                    snippets={snippets}
                    insertRequest={insertRequest}
                    bookmarkLines={bookmarks}
                    navigateRequest={navigateRequest}
                    formatRequest={formatRequest}
                    onFormatError={setError}
                    onCursorLineChange={setCursorLine}
                />
            </div>
            <div className="query-results">
                {q.resultSets.length > 1 && !plan && (
                    <div className="result-tabs" role="tablist" aria-label="Statement results">
                        {q.resultSets.map(result => (
                            <button
                                key={result.index}
                                role="tab"
                                aria-selected={result.index === q.activeResultIndex}
                                className={result.index === q.activeResultIndex ? 'active' : ''}
                                disabled={dirtyResultIndex !== null && dirtyResultIndex !== result.index}
                                onClick={() => setActiveResult(tab.id, result.index)}
                                title={dirtyResultIndex !== null && dirtyResultIndex !== result.index ? 'Apply or discard pending result edits before switching results' : result.statement}
                            >
                                Result {result.index + 1}
                                {result.summary?.error ? ' · Error' : result.summary ? ` · ${result.summary.rowsReturned || result.summary.rowsAffected}` : ''}
                            </button>
                        ))}
                    </div>
                )}
                {plan ? (
                    <div className="plan-panel">
                        <div className="plan-panel-header">
                            <span>{comparePlans ? 'Plan comparison' : planMode === 'actual' ? 'Actual query plan' : 'Estimated query plan'}</span><div className="tb-spacer" />
                            <button onClick={pinPlan} title="Pin this plan snapshot"><Pin size={12} /> Pin</button>
                            <button className={comparePlans ? 'active' : ''} disabled={planSnapshots.length < 2} onClick={() => setComparePlans(value => !value)} title="Compare pinned plans"><GitCompare size={12} /> Compare {planSnapshots.length || ''}</button>
                            <button className="icon-btn" onClick={() => setPlan(null)} title="Back to results">×</button>
                        </div>
                        {comparePlans ? <PlanComparisonView snapshots={planSnapshots} onDelete={id => setPlanSnapshots(current => current.filter(snapshot => snapshot.id !== id))} /> : <PlanTree plan={plan} />}
                    </div>
                ) : resultColumns.length > 0 ? (
                    <ResultExplorer connId={tab.connId} columns={resultColumns} rows={resultRows} resultLabel={`Result ${q.activeResultIndex + 1}`} statement={activeStatement} defaultSchema={defaultSchema} readOnly={!!conn?.readOnly} transactionActive={q.transactionActive} pinned={pinnedResults} onPin={snapshot => { const saved = saveResultSnapshot({ label: snapshot.label, connId: snapshot.connId ?? tab.connId, statement: snapshot.statement ?? activeStatement, columns: snapshot.columns, rows: snapshot.rows, truncated: !!snapshot.truncated, sourceRowCount: snapshot.sourceRowCount }); setPinnedResults(loadResultSnapshots()); return saved }} onDeletePin={id => { deleteResultSnapshot(id); setPinnedResults(loadResultSnapshots()) }} truncated={!!activeResult?.summary?.truncated} canFetchMore={isPageableResultStatement(activeStatement)} fetching={q.running} onFetchMore={() => activeResult && void fetchMoreQuery(tab.id, activeResult.statement, activeResult.index, activeResult.rows.length, q.parameterValues, schemaContext, executionSettings.rowLimit || MAX_ROWS, executionSettings.timeoutSeconds * 1000)} onRowsChange={handleResultRows} onDirtyChange={handleResultDirty} onReload={handleResultReload} resultViewContextKey={tab.id} onServerViewChange={canBuildServerResultView(resultColumns) ? view => {
                        const base = serverBaseStatement.current || activeStatement
                        const derived = buildServerResultStatement(base, resultColumns, view, engine)
                        if (derived) void runQueryView(tab.id, derived, q.parameterValues, schemaContext, executionSettings.rowLimit || MAX_ROWS, executionSettings.timeoutSeconds * 1000)
                    } : undefined} loadServerFacet={canBuildServerResultView(resultColumns) ? loadServerFacet : undefined} initialPageSize={executionSettings.rowLimit || MAX_ROWS} loadResultCount={loadResultCount} onPageChange={(offset, limit) => { if (activeResult) void fetchMoreQuery(tab.id, activeResult.statement, activeResult.index, offset, q.parameterValues, schemaContext, limit, executionSettings.timeoutSeconds * 1000, true) }} />
                ) : activeResult?.summary?.error ? (
                    <div className="results-empty error">{activeResult.summary.error}</div>
                ) : activeResult?.summary ? (
                    <div className="results-empty">{activeResult.summary.rowsAffected} rows affected</div>
                ) : (
                    <div className="results-empty">{q.running ? 'Waiting for first rows…' : 'No results'}</div>
                )}
            </div>

            {confirm !== null && (
                <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setConfirm(null)}>
                    <div className="modal modal-warn">
                        <h2>⚠ Statement affects every row</h2>
                        <p>
                            This <b>{/^update/i.test(confirm.statement) ? 'UPDATE' : 'DELETE'}</b> has no <code>WHERE</code> clause,
                            so it will change or remove all rows in the table.
                        </p>
                        <pre className="modal-sql">{confirm.statement}</pre>
                        <div className="modal-buttons">
                            <div className="spacer" />
                            <button onClick={() => setConfirm(null)}>Cancel</button>
                            <button
                                className="danger"
                                onClick={() => {
                                    saveConsoleRevision({ tabId: tab.id, title: tab.title, sql: tab.sql, reason: 'executed' })
                                    runQuery(tab.id, confirm.statement, confirm.parameters, schemaContext, executionSettings.rowLimit || MAX_ROWS, executionSettings.timeoutSeconds * 1000)
                                    setConfirm(null)
                                }}
                            >
                                Run anyway
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {localHistoryOpen && <ConsoleLocalHistoryDialog tab={tab} onClose={() => setLocalHistoryOpen(false)} onRestore={(revision: ConsoleRevision) => {
                saveConsoleRevision({ tabId: tab.id, title: tab.title, sql: tab.sql, reason: 'restore-point' })
                setTabSql(tab.id, revision.sql)
                setLocalHistoryOpen(false)
            }} />}
            {parameterRequest && (
                <QueryParametersDialog
                    names={parameterRequest.names}
                    initial={q.parameterValues}
                    onCancel={() => setParameterRequest(null)}
                    onRun={values => {
                        const statement = parameterRequest.statement
                        setParameterRequest(null)
                        execute(statement, values)
                    }}
                />
            )}
            {saveSnippet && <NameDialog title="Save SQL snippet" value="" onCancel={() => setSaveSnippet(false)} onSubmit={name => {
                const trimmed = name.trim()
                if (!trimmed) return
                const base = snippetTrigger(trimmed)
                let trigger = base
                let suffix = 2
                while (snippets.some(snippet => snippet.trigger === trigger)) trigger = `${base}_${suffix++}`
                const next = [...customSnippets, { id: `custom-${Date.now()}`, name: trimmed, trigger, sql: tab.sql }]
                setCustomSnippets(next)
                saveSQLSnippets(next)
                setSaveSnippet(false)
            }} />}
            {benchmarkOpen && <QueryBenchmarkDialog connId={tab.connId} engine={engine} statement={tab.sql} initialParameters={q.parameterValues} onClose={() => setBenchmarkOpen(false)} onError={setError} />}
        </div>
    )
}
