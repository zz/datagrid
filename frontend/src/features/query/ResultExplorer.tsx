import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Check, ChevronLeft, ChevronRight, ChevronsDown, ChevronsLeft, ChevronsRight, CircleSlash2, Copy, ExternalLink, GitCompare, Grid3X3, KeyRound, ListChecks, LoaderCircle, LockKeyhole, Pencil, Pin, Plus, Redo2, RotateCcw, Rows3, Table2, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { ApplyChangeset, Copy as CopyText, OpenTable, PreviewChangeset } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import type { Column, Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'
import ResultsGrid from '../../components/ResultsGrid'
import NameDialog from '../../components/NameDialog'
import { buildChartData, numericColumnIndexes } from './resultAnalysis'
import { commonColumnNames, compareResultRows, ResultSnapshot } from './resultComparison'
import { buildPivot, PivotAggregate } from './resultPivot'
import { buildEditableResultChanges, editableCellInput, resolveEditableResultTarget, validateEditableResult } from './editableResults'
import type { ResultCellEdit } from './editableResults'
import { EditableResultSnapshot, pushResultSnapshot, resultSnapshot, stepResultHistory } from './editableResultHistory'
import ResultChangesDialog from './ResultChangesDialog'
import TypedCellEditor from '../tabledata/TypedCellEditor'
import { normalizeTypedValue } from '../tabledata/typedValues'
import { useApp } from '../../store'
import ForeignKeyLookupDialog from './ForeignKeyLookupDialog'
import { foreignKeyForColumn, foreignKeyLookupEdits, ResultForeignKey } from './foreignKeyResultActions'
import { duplicateResultRows, setResultRowsDeleted } from './editableResultRows'
import type { ResultFacetRequest, ResultFacetResult, ResultServerView } from './serverResultView'
import { resultPageRange, resultPagination } from './resultPaging'
import { limitResultRows, processResultRows, resultViewSorts, type ResultViewState } from './resultProcessing'
import { loadResultViewState, resultViewStorageKey, saveResultViewState } from './resultViewPersistence'
import ResultViewControls from './ResultViewControls'
import { loadResultColumnLayout, normalizeResultColumnLayout, resultColumnIds, resultColumnLayoutKey, resultVisibleColumnIndexes, saveResultColumnLayout, type ResultColumnLayout } from './resultColumnLayout'

interface ResultExplorerProps {
    connId: string; columns: Column[]; rows: Value[][]; resultLabel?: string; statement?: string; defaultSchema?: string
    readOnly?: boolean; transactionActive?: boolean; pinned: ResultSnapshot[]
    onPin: (snapshot: ResultSnapshot) => ResultSnapshot; onDeletePin: (id: string) => void
    truncated?: boolean; canFetchMore?: boolean; fetching?: boolean; onFetchMore?: () => void
    onRowsChange?: (rows: Value[][]) => void; onDirtyChange?: (dirty: boolean) => void; onReload?: () => void
    onServerViewChange?: (view: ResultServerView) => void
    loadServerFacet?: (request: ResultFacetRequest) => Promise<ResultFacetResult>
    initialPageSize?: number
    loadResultCount?: () => Promise<number>
    onPageChange?: (offset: number, limit: number) => void
    resultViewContextKey?: string
}

export default function ResultExplorer({ connId, columns, rows, resultLabel = 'Result', statement = '', defaultSchema = '', readOnly = false, transactionActive = false, pinned, onPin, onDeletePin, truncated = false, canFetchMore = false, fetching = false, onFetchMore, onRowsChange, onDirtyChange, onReload, onServerViewChange, loadServerFacet, initialPageSize = 10000, loadResultCount, onPageChange, resultViewContextKey }: ResultExplorerProps) {
    const openTableWithFilter = useApp(state => state.openTableWithFilter)
    const engine = useApp(state => state.connections.find(connection => connection.id === connId)?.engine ?? 'postgres')
    const [mode, setMode] = useState<'grid' | 'record' | 'chart' | 'pivot' | 'compare'>('grid')
    const [rowIndex, setRowIndex] = useState(0)
    const [labelIndex, setLabelIndex] = useState(0)
    const [valueIndex, setValueIndex] = useState(0)
    const [chartType, setChartType] = useState<'bar' | 'line'>('bar')
    const [baselineId, setBaselineId] = useState('')
    const [keyColumn, setKeyColumn] = useState('')
    const [showEqual, setShowEqual] = useState(false)
    const [pivotRow, setPivotRow] = useState(0)
    const [pivotColumn, setPivotColumn] = useState(-1)
    const [pivotValue, setPivotValue] = useState(0)
    const [pivotAggregate, setPivotAggregate] = useState<PivotAggregate>('count')
    const [namingSnapshot, setNamingSnapshot] = useState(false)
    const [workingRows, setWorkingRows] = useState(rows)
    const [baseRows, setBaseRows] = useState(rows)
    const [tableInfo, setTableInfo] = useState<drivers.TableInfo | null>(null)
    const [editTarget, setEditTarget] = useState<ReturnType<typeof resolveEditableResultTarget>['target']>(null)
    const [editReason, setEditReason] = useState('Checking result editability...')
    const [edits, setEdits] = useState<Record<string, { rowIndex: number; columnIndex: number; cell: { null: boolean; text: string } }>>({})
    const [insertedRows, setInsertedRows] = useState<Set<number>>(new Set())
    const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set())
    const [undoStack, setUndoStack] = useState<EditableResultSnapshot[]>([])
    const [redoStack, setRedoStack] = useState<EditableResultSnapshot[]>([])
    const [conflicts, setConflicts] = useState<drivers.ChangeConflict[]>([])
    const [applyingEdits, setApplyingEdits] = useState(false)
    const [editError, setEditError] = useState('')
    const [showChanges, setShowChanges] = useState(false)
    const [previews, setPreviews] = useState<string[]>([])
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewError, setPreviewError] = useState('')
    const [typedEdit, setTypedEdit] = useState<{ rowIndex: number; columnIndex: number; column: string; columnType: string; cell: Value } | null>(null)
    const [foreignKeyLookup, setForeignKeyLookup] = useState<{ foreignKey: ResultForeignKey; rowIndex: number } | null>(null)
    const [totalRows, setTotalRows] = useState<number | null>(null)
    const [countingRows, setCountingRows] = useState(false)
    const [countError, setCountError] = useState('')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(Math.max(1, initialPageSize))
    const viewStorageKey = useMemo(() => resultViewStorageKey(resultViewContextKey ?? connId, columns), [columns, connId, resultViewContextKey])
    const [storedResultView, setStoredResultView] = useState(() => ({ key: viewStorageKey, view: loadResultViewState(viewStorageKey, columns.length) }))
    if (storedResultView.key !== viewStorageKey) setStoredResultView({ key: viewStorageKey, view: loadResultViewState(viewStorageKey, columns.length) })
    const resultView = storedResultView.key === viewStorageKey ? storedResultView.view : loadResultViewState(viewStorageKey, columns.length)
    const updateResultView = useCallback((view: ResultViewState) => {
        setStoredResultView(current => current.key === viewStorageKey ? { key: viewStorageKey, view } : current)
        if (typeof window !== 'undefined') saveResultViewState(viewStorageKey, view)
    }, [viewStorageKey])
    const columnIds = useMemo(() => resultColumnIds(columns), [columns])
    const columnLayoutKey = useMemo(() => resultColumnLayoutKey(connId, columns), [columns, connId])
    const [storedColumnLayout, setStoredColumnLayout] = useState(() => ({ key: columnLayoutKey, layout: loadResultColumnLayout(columnLayoutKey) }))
    if (storedColumnLayout.key !== columnLayoutKey) setStoredColumnLayout({ key: columnLayoutKey, layout: loadResultColumnLayout(columnLayoutKey) })
    const columnLayout = useMemo(() => normalizeResultColumnLayout(storedColumnLayout.key === columnLayoutKey ? storedColumnLayout.layout : loadResultColumnLayout(columnLayoutKey), columnIds), [columnIds, columnLayoutKey, storedColumnLayout])
    const visibleColumnIndexes = useMemo(() => resultVisibleColumnIndexes(columnLayout, columnIds), [columnIds, columnLayout])
    const visibleColumns = useMemo(() => visibleColumnIndexes.map(index => columns[index]), [columns, visibleColumnIndexes])
    const updateColumnLayout = useCallback((layout: ResultColumnLayout) => {
        const normalized = normalizeResultColumnLayout(layout, columnIds)
        setStoredColumnLayout(current => current.key === columnLayoutKey ? { key: columnLayoutKey, layout: normalized } : current)
        if (typeof window !== 'undefined') saveResultColumnLayout(columnLayoutKey, normalized)
    }, [columnIds, columnLayoutKey])
    const countLoader = useRef(loadResultCount)
    useEffect(() => { countLoader.current = loadResultCount }, [loadResultCount])
    useEffect(() => {
        setPage(0); setPageSize(Math.max(1, initialPageSize)); setTotalRows(null); setCountError('')
        if (!canFetchMore || !countLoader.current || !statement) { setCountingRows(false); return }
        let ignored = false
        setCountingRows(true)
        countLoader.current().then(count => { if (!ignored) setTotalRows(count) }).catch(error => { if (!ignored) setCountError(String(error)) }).finally(() => { if (!ignored) setCountingRows(false) })
        return () => { ignored = true }
    }, [canFetchMore, initialPageSize, statement])

    useEffect(() => { setWorkingRows(rows); setBaseRows(rows); setEdits({}); setInsertedRows(new Set()); setDeletedRows(new Set()); setUndoStack([]); setRedoStack([]); setConflicts([]); setEditError(''); setShowChanges(false); setPreviews([]); setPreviewError('') }, [rows, statement])
    useEffect(() => {
        let cancelled = false
        const parsed = resolveEditableResultTarget(statement, defaultSchema)
        setTableInfo(null); setEditTarget(null)
        if (!parsed.target) { setEditReason(parsed.reason); return () => { cancelled = true } }
        setEditReason('Checking source table...')
        OpenTable(connId, parsed.target.schema, parsed.target.table).then(info => {
            if (cancelled) return
            const validated = validateEditableResult(parsed.target!, columns, info)
            setTableInfo(info); setEditTarget(validated.target); setEditReason(validated.reason)
        }).catch(error => { if (!cancelled) setEditReason(String(error)) })
        return () => { cancelled = true }
    }, [columns, connId, defaultSchema, statement])

    const editable = !!editTarget && !!tableInfo && !readOnly && !transactionActive
    const disabledReason = readOnly ? 'The connection is read-only.' : transactionActive ? 'Finish the active console transaction before editing result rows.' : editReason
    const dirty = Object.keys(edits).length > 0 || insertedRows.size > 0 || deletedRows.size > 0
    const serverViewKey = JSON.stringify({ filters: resultView.filters, expression: resultView.expression ?? null, search: resultView.search, sorts: resultViewSorts(resultView) })
    const lastServerView = useRef(JSON.stringify({ filters: [], expression: null, search: '', sorts: [] }))
    useEffect(() => {
        if (!onServerViewChange || !canFetchMore || dirty || fetching || serverViewKey === lastServerView.current) return
        const timer = window.setTimeout(() => {
            lastServerView.current = serverViewKey
            onServerViewChange(resultView)
        }, 300)
        return () => window.clearTimeout(timer)
    }, [canFetchMore, dirty, fetching, onServerViewChange, resultView, serverViewKey])
    const visibleRows = useMemo(() => {
        const processed = processResultRows(workingRows, resultView)
        return limitResultRows(processed, resultView.analysisLimit)
    }, [resultView, workingRows])
    const recordSourceRow = visibleRows[rowIndex] ? workingRows.indexOf(visibleRows[rowIndex]) : -1
    const resultIncomplete = totalRows != null ? workingRows.length < totalRows : truncated
    const pagination = resultPagination(totalRows, page, pageSize)
    const pageRange = resultPageRange(page, pageSize, workingRows.length)
    const changePage = (nextPage: number, nextSize = pageSize) => {
        const next = resultPagination(totalRows, nextPage, nextSize)
        setPage(next.page); setPageSize(next.pageSize); onPageChange?.(next.offset, next.pageSize)
    }
    const pendingChanges = useMemo(() => tableInfo ? buildEditableResultChanges(columns, baseRows, tableInfo.primaryKey, Object.values(edits), insertedRows, deletedRows) : [], [baseRows, columns, deletedRows, edits, insertedRows, tableInfo])
    const pendingCount = pendingChanges.length
    useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
    useEffect(() => {
        let cancelled = false
        if (!editTarget || !pendingChanges.length) { setPreviews([]); setPreviewLoading(false); setPreviewError(''); return () => { cancelled = true } }
        setPreviewLoading(true); setPreviewError('')
        const changes = pendingChanges.map(change => drivers.RowChange.createFrom(change))
        PreviewChangeset(connId, drivers.ChangesetRequest.createFrom({ schema: editTarget.schema, table: editTarget.table, changes, force: false })).then(sql => {
            if (!cancelled) { setPreviews(sql ?? []); setPreviewLoading(false) }
        }).catch(error => {
            if (!cancelled) { setPreviewError(String(error)); setPreviewLoading(false) }
        })
        return () => { cancelled = true }
    }, [connId, editTarget, pendingChanges])
    const editedCells = useMemo(() => new Set(Object.keys(edits)), [edits])
    const numeric = useMemo(() => {
        const visible = new Set(visibleColumnIndexes)
        return numericColumnIndexes(columns, visibleRows).filter(index => visible.has(index))
    }, [columns, visibleColumnIndexes, visibleRows])
    useEffect(() => setRowIndex(index => Math.min(index, Math.max(0, visibleRows.length - 1))), [visibleRows.length])
    useEffect(() => { if (!numeric.includes(valueIndex)) setValueIndex(numeric[0] ?? 0) }, [numeric, valueIndex])
    useEffect(() => { if (!visibleColumnIndexes.includes(labelIndex)) setLabelIndex(visibleColumnIndexes[0] ?? 0) }, [labelIndex, visibleColumnIndexes])
    useEffect(() => { if (mode === 'chart' && !numeric.length) setMode('grid') }, [mode, numeric.length])
    useEffect(() => { if (!numeric.includes(pivotValue)) setPivotValue(numeric[0] ?? 0) }, [numeric, pivotValue])
    useEffect(() => { if (!numeric.length && pivotAggregate !== 'count') setPivotAggregate('count') }, [numeric.length, pivotAggregate])
    useEffect(() => { if (!visibleColumnIndexes.includes(pivotRow)) setPivotRow(visibleColumnIndexes[0] ?? 0); if (pivotColumn >= 0 && !visibleColumnIndexes.includes(pivotColumn)) setPivotColumn(-1) }, [pivotColumn, pivotRow, visibleColumnIndexes])
    const points = useMemo(() => buildChartData(visibleRows, labelIndex, valueIndex), [labelIndex, visibleRows, valueIndex])
    const projectedRows = useMemo(() => visibleRows.map(row => visibleColumnIndexes.map(index => row[index] ?? { t: 'null' })), [visibleColumnIndexes, visibleRows])
    const current = useMemo<ResultSnapshot>(() => ({ id: 'current', label: resultLabel, columns: visibleColumns, rows: projectedRows }), [projectedRows, resultLabel, visibleColumns])
    const baseline = pinned.find(item => item.id === baselineId) ?? pinned[0]
    const commonKeys = useMemo(() => baseline ? commonColumnNames(baseline, current) : [], [baseline, current])
    useEffect(() => { if (keyColumn && !commonKeys.includes(keyColumn)) setKeyColumn('') }, [commonKeys, keyColumn])
    const compared = useMemo(() => baseline ? compareResultRows(baseline, current, keyColumn) : [], [baseline, current, keyColumn])
    const pivot = useMemo(() => buildPivot(visibleRows, pivotRow, pivotColumn < 0 ? null : pivotColumn, pivotValue, pivotAggregate), [pivotAggregate, pivotColumn, pivotRow, pivotValue, visibleRows])
    const pinCurrent = (label: string) => { const createdAt = Date.now(); const item = { ...current, id: `pinned-${createdAt}`, label: label.trim(), connId, statement, createdAt, sourceRowCount: visibleRows.length, truncated: resultIncomplete, rows: current.rows.map(row => [...row]) }; const saved = onPin(item); setBaselineId(saved.id); setNamingSnapshot(false) }

    const commitResultState = useCallback((nextRows: Value[][], nextEdits: Record<string, ResultCellEdit>, nextInsertedRows = insertedRows, nextDeletedRows = deletedRows) => {
        setUndoStack(current => pushResultSnapshot(current, resultSnapshot(workingRows, edits, insertedRows, deletedRows)))
        setRedoStack([])
        setWorkingRows(nextRows); setEdits(nextEdits); setInsertedRows(nextInsertedRows); setDeletedRows(nextDeletedRows)
        setConflicts([]); setEditError('')
    }, [deletedRows, edits, insertedRows, workingRows])

    const stageCellEdits = (changes: Array<{ rowIndex: number; columnIndex: number; text: string; isNull: boolean }>) => {
        if (!editable || !tableInfo || !changes.length) return
        const prepared: typeof changes = []
        for (const change of changes) {
            const column = columns[change.columnIndex]
            const detail = tableInfo.columns?.find(item => item.name === column?.name)
            if (!column || !detail) continue
            const isNull = change.isNull && detail.nullable
            if (isNull) { prepared.push({ ...change, isNull: true, text: '' }); continue }
            const normalized = normalizeTypedValue(detail.typeName || column.typeName, workingRows[change.rowIndex]?.[change.columnIndex]?.t ?? 'null', change.text)
            if (normalized.error) { setEditError(`${column.name}: ${normalized.error}`); return }
            prepared.push({ ...change, isNull: false, text: normalized.value })
        }
        if (!prepared.length) return
        const nextRows = [...workingRows]
        const copiedRows = new Set<number>()
        const nextEdits = { ...edits }
        let changed = false
        for (const change of prepared) {
            if (deletedRows.has(change.rowIndex) || !columns[change.columnIndex] || !nextRows[change.rowIndex]) continue
            const nullable = tableInfo.columns?.find(item => item.name === columns[change.columnIndex].name)?.nullable ?? false
            const cell = { null: change.isNull && nullable, text: change.text }
            const current = editableCellInput(nextRows[change.rowIndex][change.columnIndex])
            const editKey = `${change.rowIndex}:${change.columnIndex}`
            const explicitInsertedNull = insertedRows.has(change.rowIndex) && cell.null && !nextEdits[editKey]
            if (current.null === cell.null && current.text === cell.text && !explicitInsertedNull) continue
            if (!copiedRows.has(change.rowIndex)) { nextRows[change.rowIndex] = [...nextRows[change.rowIndex]]; copiedRows.add(change.rowIndex) }
            nextRows[change.rowIndex][change.columnIndex] = cell.null ? { t: 'null' } : { t: 'str', v: cell.text }
            const original = editableCellInput(baseRows[change.rowIndex]?.[change.columnIndex])
            if (!insertedRows.has(change.rowIndex) && cell.null === original.null && cell.text === original.text) delete nextEdits[editKey]
            else nextEdits[editKey] = { rowIndex: change.rowIndex, columnIndex: change.columnIndex, cell }
            changed = true
        }
        if (changed) commitResultState(nextRows, nextEdits)
    }
    const stageInsertRow = () => {
        if (!editable) return
        const sourceRow = workingRows.length
        commitResultState([...workingRows, columns.map(() => ({ t: 'null' }))], edits, new Set(insertedRows).add(sourceRow))
        setMode('grid')
    }
    const removeInsertedRow = (sourceRow: number) => {
        const nextEdits: Record<string, ResultCellEdit> = {}
        Object.values(edits).forEach(edit => {
            if (edit.rowIndex === sourceRow) return
            const rowIndex = edit.rowIndex > sourceRow ? edit.rowIndex - 1 : edit.rowIndex
            nextEdits[`${rowIndex}:${edit.columnIndex}`] = { ...edit, rowIndex }
        })
        const remap = (values: Set<number>) => new Set([...values].filter(index => index !== sourceRow).map(index => index > sourceRow ? index - 1 : index))
        commitResultState(workingRows.filter((_, index) => index !== sourceRow), nextEdits, remap(insertedRows), remap(deletedRows))
    }
    const stageDuplicateRows = (sourceRows: number[]) => {
        if (!editable || !tableInfo) return
        const result = duplicateResultRows({ rows: workingRows, edits, insertedRows, deletedRows }, columns, tableInfo.primaryKey ?? [], sourceRows)
        if (result) commitResultState(result.rows, result.edits, result.insertedRows, result.deletedRows)
    }
    const setRowsDeleted = (sourceRows: number[], deleted: boolean) => {
        if (!editable) return
        const result = setResultRowsDeleted({ rows: workingRows, edits, insertedRows, deletedRows }, sourceRows, deleted)
        if (result) commitResultState(result.rows, result.edits, result.insertedRows, result.deletedRows)
    }
    const toggleDeleteRow = (sourceRow: number) => {
        setRowsDeleted([sourceRow], !deletedRows.has(sourceRow))
    }
    const revertResultChange = (change: (typeof pendingChanges)[number], column?: string) => {
        if (change.kind === 'delete') { toggleDeleteRow(change.rowIndex); return }
        if (change.kind === 'insert' && !column) { removeInsertedRow(change.rowIndex); return }
        const fields = column ? [column] : Object.keys(change.set)
        const nextRows = [...workingRows]
        nextRows[change.rowIndex] = [...nextRows[change.rowIndex]]
        const nextEdits = { ...edits }
        fields.forEach(name => {
            const columnIndex = columns.findIndex(item => item.name === name)
            if (columnIndex < 0) return
            nextRows[change.rowIndex][columnIndex] = change.kind === 'insert' ? { t: 'null' } : baseRows[change.rowIndex]?.[columnIndex] ?? { t: 'null' }
            delete nextEdits[`${change.rowIndex}:${columnIndex}`]
        })
        commitResultState(nextRows, nextEdits)
    }
    const restoreSnapshot = useCallback((snapshot: EditableResultSnapshot) => {
        setWorkingRows(snapshot.rows); setEdits(snapshot.edits); setInsertedRows(new Set(snapshot.insertedRows)); setDeletedRows(new Set(snapshot.deletedRows)); setConflicts([]); setEditError('')
    }, [])
    const undoResultEdit = useCallback(() => {
        const stepped = stepResultHistory(resultSnapshot(workingRows, edits, insertedRows, deletedRows), undoStack, redoStack)
        if (!stepped) return
        setUndoStack(stepped.from); setRedoStack(stepped.to); restoreSnapshot(stepped.target)
    }, [deletedRows, edits, insertedRows, redoStack, restoreSnapshot, undoStack, workingRows])
    const redoResultEdit = useCallback(() => {
        const stepped = stepResultHistory(resultSnapshot(workingRows, edits, insertedRows, deletedRows), redoStack, undoStack)
        if (!stepped) return
        setRedoStack(stepped.from); setUndoStack(stepped.to); restoreSnapshot(stepped.target)
    }, [deletedRows, edits, insertedRows, redoStack, restoreSnapshot, undoStack, workingRows])
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
            event.preventDefault()
            if (event.shiftKey) redoResultEdit(); else undoResultEdit()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [redoResultEdit, undoResultEdit])
    const discardResultEdits = () => { setWorkingRows(baseRows); setEdits({}); setInsertedRows(new Set()); setDeletedRows(new Set()); setUndoStack([]); setRedoStack([]); setConflicts([]); setEditError('') }
    const openResultCellEditor = (sourceRow: number, columnIndex: number) => {
        const column = columns[columnIndex]
        const detail = tableInfo?.columns?.find(item => item.name === column?.name)
        const cell = workingRows[sourceRow]?.[columnIndex]
        if (column && detail && cell) setTypedEdit({ rowIndex: sourceRow, columnIndex, column: column.name, columnType: detail.typeName, cell })
    }
    const applyResultEdits = async (force = false) => {
        if (!editTarget || !tableInfo || !dirty) return
        const changes = pendingChanges.map(change => drivers.RowChange.createFrom(change))
        const hadInserts = changes.some(change => change.kind === 'insert')
        const nextRows = workingRows.filter((_, index) => !deletedRows.has(index))
        if (!changes.length) {
            setWorkingRows(nextRows); setBaseRows(nextRows); setEdits({}); setInsertedRows(new Set()); setDeletedRows(new Set()); setUndoStack([]); setRedoStack([]); onRowsChange?.(nextRows)
            return
        }
        setApplyingEdits(true); setEditError('')
        try {
            const result = await ApplyChangeset(connId, drivers.ChangesetRequest.createFrom({ schema: editTarget.schema, table: editTarget.table, changes, force }))
            if (result.conflicts?.length) { setConflicts(result.conflicts); return }
            setWorkingRows(nextRows); setBaseRows(nextRows); setEdits({}); setInsertedRows(new Set()); setDeletedRows(new Set()); setUndoStack([]); setRedoStack([]); setConflicts([]); onRowsChange?.(nextRows)
            if (hadInserts) onReload?.()
        } catch (error) { setEditError(String(error)) } finally { setApplyingEdits(false) }
    }

    return <div className="result-explorer">
        <div className="result-view-toolbar">
            <div className="result-view-segment" role="tablist" aria-label="Result view">
                <button className={mode === 'grid' ? 'active' : ''} onClick={() => setMode('grid')} title="Grid view"><Table2 size={13} /> Grid</button>
                <button className={mode === 'record' ? 'active' : ''} onClick={() => setMode('record')} title="Transposed record"><Rows3 size={13} /> Record</button>
                <button className={mode === 'chart' ? 'active' : ''} onClick={() => setMode('chart')} disabled={!numeric.length} title="Chart numeric columns"><BarChart3 size={13} /> Chart</button>
                <button className={mode === 'pivot' ? 'active' : ''} onClick={() => setMode('pivot')} disabled={!visibleColumns.length} title="Pivot result rows"><Grid3X3 size={13} /> Pivot</button>
                <button className={mode === 'compare' ? 'active' : ''} onClick={() => setMode('compare')} disabled={!pinned.length} title="Compare with pinned result"><GitCompare size={13} /> Compare</button>
            </div>
            {mode === 'record' && <div className="record-nav"><button className="icon-btn" onClick={() => setRowIndex(index => Math.max(0, index - 1))} disabled={rowIndex === 0} title="Previous row"><ChevronLeft size={13} /></button><span>Row {visibleRows.length ? rowIndex + 1 : 0} of {visibleRows.length}</span><button className="icon-btn" onClick={() => setRowIndex(index => Math.min(visibleRows.length - 1, index + 1))} disabled={rowIndex >= visibleRows.length - 1} title="Next row"><ChevronRight size={13} /></button>{editable && recordSourceRow >= 0 && <button className={`icon-btn ${deletedRows.has(recordSourceRow) ? 'active' : ''}`} onClick={() => toggleDeleteRow(recordSourceRow)} title={deletedRows.has(recordSourceRow) ? 'Restore row' : 'Delete row'}>{deletedRows.has(recordSourceRow) ? <RotateCcw size={12} /> : <Trash2 size={12} />}</button>}</div>}
            {mode === 'chart' && <div className="chart-controls"><label>Label<select value={labelIndex} onChange={event => setLabelIndex(Number(event.target.value))}>{visibleColumnIndexes.map(index => <option value={index} key={`${columns[index].name}-${index}`}>{columns[index].name}</option>)}</select></label><label>Value<select value={valueIndex} onChange={event => setValueIndex(Number(event.target.value))}>{numeric.map(index => <option value={index} key={`${columns[index].name}-${index}`}>{columns[index].name}</option>)}</select></label><div className="result-view-segment"><button className={chartType === 'bar' ? 'active' : ''} onClick={() => setChartType('bar')}>Bars</button><button className={chartType === 'line' ? 'active' : ''} onClick={() => setChartType('line')}>Line</button></div></div>}
            {mode === 'pivot' && <div className="pivot-controls"><label>Rows<select value={pivotRow} onChange={event => setPivotRow(Number(event.target.value))}>{visibleColumnIndexes.map(index => <option value={index} key={`${columns[index].name}-${index}`}>{columns[index].name}</option>)}</select></label><label>Columns<select value={pivotColumn} onChange={event => setPivotColumn(Number(event.target.value))}><option value={-1}>None</option>{visibleColumnIndexes.map(index => <option value={index} key={`${columns[index].name}-${index}`}>{columns[index].name}</option>)}</select></label><label>Aggregate<select value={pivotAggregate} onChange={event => setPivotAggregate(event.target.value as PivotAggregate)}><option value="count">Count</option>{numeric.length > 0 && <><option value="sum">Sum</option><option value="average">Average</option><option value="min">Minimum</option><option value="max">Maximum</option></>}</select></label>{pivotAggregate !== 'count' && <label>Values<select value={pivotValue} onChange={event => setPivotValue(Number(event.target.value))}>{numeric.map(index => <option value={index} key={`${columns[index].name}-${index}`}>{columns[index].name}</option>)}</select></label>}</div>}
            {mode === 'compare' && baseline && <div className="compare-controls"><label>Baseline<select value={baseline.id} onChange={event => setBaselineId(event.target.value)}>{pinned.map(item => <option value={item.id} key={item.id}>{item.label} · {item.rows.length.toLocaleString()} rows</option>)}</select></label><label>Match rows<select value={keyColumn} onChange={event => setKeyColumn(event.target.value)}><option value="">Row position</option>{commonKeys.map(name => <option key={name}>{name}</option>)}</select></label><span className="compare-snapshot-meta" title={baseline.statement}>{baseline.createdAt ? new Date(baseline.createdAt).toLocaleDateString() : ''}{baseline.connId ? ` · ${baseline.connId}` : ''}</span><label><input type="checkbox" checked={showEqual} onChange={event => setShowEqual(event.target.checked)} /> Unchanged</label><button className="icon-btn" title="Delete baseline" onClick={() => { onDeletePin(baseline.id); const next = pinned.filter(item => item.id !== baseline.id); setBaselineId(next[0]?.id ?? ''); if (!next.length) setMode('grid') }}><Trash2 size={12} /></button></div>}
            <div className="tb-spacer" /><span className="result-view-summary" title={countError}>{totalRows == null ? `${workingRows.length.toLocaleString()} rows` : pageRange ? `${pageRange.start.toLocaleString()}-${pageRange.end.toLocaleString()} of ${totalRows.toLocaleString()}` : `0 of ${totalRows.toLocaleString()}`}{visibleRows.length !== workingRows.length ? ` · ${visibleRows.length.toLocaleString()} visible` : ''}</span>{countingRows && <LoaderCircle className="result-count-loading" size={12} />}
            {editable ? <>{(undoStack.length > 0 || redoStack.length > 0) && <><button className="icon-btn" onClick={undoResultEdit} disabled={!undoStack.length || applyingEdits} title="Undo result edit (Cmd/Ctrl+Z)"><Undo2 size={13} /></button><button className="icon-btn" onClick={redoResultEdit} disabled={!redoStack.length || applyingEdits} title="Redo result edit (Cmd/Ctrl+Shift+Z)"><Redo2 size={13} /></button></>}<button className="icon-btn" onClick={stageInsertRow} disabled={applyingEdits} title="Add result row"><Plus size={13} /></button>{dirty ? <><button onClick={() => setShowChanges(true)} title="Inspect pending result changes"><ListChecks size={12} /> {pendingCount} pending</button><button onClick={discardResultEdits} disabled={applyingEdits} title="Discard result edits"><RotateCcw size={12} /> Discard</button><button className="primary" onClick={() => void applyResultEdits()} disabled={applyingEdits || pendingCount === 0}><Check size={12} /> {applyingEdits ? 'Applying' : 'Apply'}</button></> : <span className="result-editable-state" title={`Editable result from ${editTarget?.schema}.${editTarget?.table}`}><Check size={12} /> Editable</span>}</> : <span className="result-readonly-state" title={disabledReason}><LockKeyhole size={12} /></span>}
            {totalRows != null && onPageChange && totalRows > pageSize && <div className="result-page-controls"><button className="icon-btn" disabled={fetching || dirty || page === 0} onClick={() => changePage(0)} title="First page"><ChevronsLeft size={12} /></button><button className="icon-btn" disabled={fetching || dirty || page === 0} onClick={() => changePage(page - 1)} title="Previous page"><ChevronLeft size={12} /></button><span>{page + 1} / {pagination.pageCount}</span><button className="icon-btn" disabled={fetching || dirty || page >= pagination.pageCount - 1} onClick={() => changePage(page + 1)} title="Next page"><ChevronRight size={12} /></button><button className="icon-btn" disabled={fetching || dirty || page >= pagination.pageCount - 1} onClick={() => changePage(pagination.pageCount - 1)} title="Last page"><ChevronsRight size={12} /></button><select value={pageSize} disabled={fetching || dirty} onChange={event => changePage(0, Number(event.target.value))} aria-label="Result page size">{[...new Set([200, 500, 1000, initialPageSize, pageSize])].sort((a, b) => a - b).map(size => <option value={size} key={size}>{size.toLocaleString()}</option>)}</select></div>}
            {totalRows == null && truncated && canFetchMore && <button onClick={onFetchMore} disabled={fetching || dirty} title={dirty ? 'Apply or discard edits before fetching more rows' : 'Fetch and append the next result page'}><ChevronsDown size={12} /> {fetching ? 'Fetching' : 'Fetch More'}</button>}
            {totalRows == null && truncated && !canFetchMore && <span className="result-limit-state">Row limit reached</span>}
            <button onClick={() => setNamingSnapshot(true)} title="Save a named result snapshot"><Pin size={12} /> Snapshot{pinned.length ? ` ${pinned.length}` : ''}</button>
        </div>
        {mode !== 'grid' && <ResultViewControls columns={columns} columnIds={columnIds} columnLayout={columnLayout} rows={visibleRows.length} view={resultView} presetContextKey={columnLayoutKey} engine={engine} serverActive={!dirty && canFetchMore && !!onServerViewChange} serverBusy={fetching} onChange={updateResultView} onColumnLayoutChange={updateColumnLayout} />}
        {editError && <div className="result-edit-error">{editError}</div>}
        {mode === 'grid' ? <ResultsGrid key={viewStorageKey} connId={connId} columns={columns} rows={workingRows} editable={editable} editedCells={editedCells} insertedRows={insertedRows} deletedRows={deletedRows} columnDetails={tableInfo?.columns ?? []} foreignKeys={tableInfo?.foreignKeys ?? []} sqlTable={editTarget && tableInfo ? `${tableInfo.schema}.${tableInfo.table}` : undefined} sqlEngine={engine} exportBaseName={resultLabel.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'query-result'} truncated={resultIncomplete} onCellsEdit={stageCellEdits} onToggleDeleteRow={toggleDeleteRow} onOpenTypedEditor={openResultCellEditor} onNavigateForeignKey={(foreignKey, referencedColumn, value) => void openTableWithFilter(connId, foreignKey.referencedSchema || tableInfo?.schema || defaultSchema, foreignKey.referencedTable, referencedColumn, value)} onOpenForeignKeyLookup={(foreignKey, sourceRow) => setForeignKeyLookup({ foreignKey, rowIndex: sourceRow })} onDuplicateRows={stageDuplicateRows} onSetRowsDeleted={setRowsDeleted} serverViewBusy={fetching} serverViewActive={!dirty && canFetchMore && !!onServerViewChange} loadServerFacet={!dirty && canFetchMore ? loadServerFacet : undefined} initialViewState={resultView} onViewStateChange={updateResultView} initialColumnLayout={columnLayout} onColumnLayoutChange={updateColumnLayout} /> : mode === 'record' ? <div className={`record-view ${deletedRows.has(recordSourceRow) ? 'deleted' : ''}`}>
            {visibleRows.length === 0 ? <div className="results-empty">No result row selected.</div> : visibleColumnIndexes.map((index, displayedIndex) => {
                const column = columns[index]
                const value = visibleRows[rowIndex]?.[index] ?? { t: 'null' }
                const text = displayValue(value)
                const detail = tableInfo?.columns?.find(item => item.name === column.name)
                const foreignKey = foreignKeyForColumn(tableInfo?.foreignKeys ?? [], column.name)
                const foreignKeyIndex = foreignKey?.columns.indexOf(column.name) ?? -1
                const referencedColumn = foreignKeyIndex >= 0 ? foreignKey?.referencedColumns[foreignKeyIndex] : undefined
                const changed = editedCells.has(`${recordSourceRow}:${index}`)
                return <div className={`record-field ${changed ? 'edited' : ''} ${insertedRows.has(recordSourceRow) ? 'inserted' : ''}`} key={`${column.name}-${index}`}><div><strong>{column.name}{displayedIndex < columnLayout.frozen && <small>PIN</small>}{tableInfo?.primaryKey.includes(column.name) && <small>PK</small>}{foreignKey && <small>FK</small>}</strong><span>{detail?.typeName ?? column.typeName}</span></div><pre className={value.t === 'null' ? 'null' : ''} onDoubleClick={() => editable && recordSourceRow >= 0 && !deletedRows.has(recordSourceRow) && openResultCellEditor(recordSourceRow, index)}>{text}</pre><div className="record-field-actions"><button className="icon-btn" onClick={() => CopyText(value.t === 'null' ? '' : text)} title="Copy value"><Copy size={12} /></button>{foreignKey && referencedColumn && value.t !== 'null' && <button className="icon-btn" onClick={() => void openTableWithFilter(connId, foreignKey.referencedSchema || tableInfo?.schema || defaultSchema, foreignKey.referencedTable, referencedColumn, text)} title={`Go to referenced row in ${foreignKey.referencedTable}`}><ExternalLink size={12} /></button>}{editable && recordSourceRow >= 0 && !deletedRows.has(recordSourceRow) && <><button className="icon-btn" onClick={() => openResultCellEditor(recordSourceRow, index)} title={`Edit ${column.name}`}><Pencil size={12} /></button>{foreignKey && <button className="icon-btn" onClick={() => setForeignKeyLookup({ foreignKey, rowIndex: recordSourceRow })} title="Choose referenced value"><KeyRound size={12} /></button>}<button className="icon-btn" disabled={!detail?.nullable} onClick={() => stageCellEdits([{ rowIndex: recordSourceRow, columnIndex: index, text: '', isNull: true }])} title={detail?.nullable ? 'Set NULL' : 'Column is not nullable'}><CircleSlash2 size={12} /></button></>}</div></div>
            })}
        </div> : mode === 'chart' ? <ResultChart points={points} type={chartType} /> : mode === 'pivot' ? <PivotTable pivot={pivot} /> : <ResultComparison rows={showEqual ? compared : compared.filter(row => row.status !== 'equal')} total={compared.length} />}
        {conflicts.length > 0 && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setConflicts([])}><div className="modal modal-warn edit-conflict-dialog" role="alertdialog" aria-modal="true"><h2><TriangleAlert size={18} /> Result row changed</h2><p>The changeset was rolled back and your pending result edits were preserved.</p><div className="edit-conflict-list">{conflicts.map(conflict => <div key={`${conflict.changeIndex}-${conflict.kind}`}><b>{conflict.kind}</b><code>{Object.entries(conflict.key ?? {}).map(([name, value]) => `${name}=${value.null ? 'NULL' : value.text}`).join(', ')}</code><span>{conflict.reason}</span></div>)}</div><div className="modal-buttons"><button onClick={() => setConflicts([])}>Keep editing</button><div className="spacer" /><button className="danger" onClick={discardResultEdits}>Discard changes</button><button className="primary" onClick={() => { setConflicts([]); void applyResultEdits(true) }}>Overwrite anyway</button></div></div></div>}
        {showChanges && <ResultChangesDialog columns={columns} baseRows={baseRows} changes={pendingChanges} previews={previews} previewLoading={previewLoading} previewError={previewError} onClose={() => setShowChanges(false)} onRevert={revertResultChange} />}
        {typedEdit && <TypedCellEditor connId={connId} column={typedEdit.column} columnType={typedEdit.columnType} cell={typedEdit.cell} onCancel={() => setTypedEdit(null)} onSave={value => { stageCellEdits([{ rowIndex: typedEdit.rowIndex, columnIndex: typedEdit.columnIndex, text: value, isNull: false }]); setTypedEdit(null) }} />}
        {foreignKeyLookup && <ForeignKeyLookupDialog connId={connId} foreignKey={foreignKeyLookup.foreignKey} onCancel={() => setForeignKeyLookup(null)} onSelect={(referenceColumns, referenceRow) => { stageCellEdits(foreignKeyLookupEdits(foreignKeyLookup.foreignKey, columns, referenceColumns, referenceRow, foreignKeyLookup.rowIndex)); setForeignKeyLookup(null) }} />}
        {namingSnapshot && <NameDialog title="Save Result Snapshot" value={`${resultLabel} - ${new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`} onCancel={() => setNamingSnapshot(false)} onSubmit={name => name.trim() && pinCurrent(name)} />}
    </div>
}

function ResultChart({ points, type }: { points: Array<{ label: string; value: number }>; type: 'bar' | 'line' }) {
    if (!points.length) return <div className="results-empty">No numeric values to chart.</div>
    const width = 1000
    const height = 430
    const pad = { left: 64, right: 20, top: 24, bottom: 72 }
    const values = points.map(point => point.value)
    const minimum = Math.min(0, ...values)
    const maximum = Math.max(0, ...values)
    const span = maximum - minimum || 1
    const x = (index: number) => pad.left + (index + 0.5) * (width - pad.left - pad.right) / points.length
    const y = (value: number) => pad.top + (maximum - value) / span * (height - pad.top - pad.bottom)
    const baseline = y(0)
    const barWidth = Math.max(2, Math.min(48, (width - pad.left - pad.right) / points.length * 0.72))
    return <div className="result-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Query result chart">
        <line className="chart-axis" x1={pad.left} x2={width - pad.right} y1={baseline} y2={baseline} />
        <line className="chart-axis" x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} />
        {[0, 0.25, 0.5, 0.75, 1].map(tick => { const value = maximum - tick * span; const yy = y(value); return <g key={tick}><line className="chart-grid" x1={pad.left} x2={width - pad.right} y1={yy} y2={yy} /><text className="chart-label" x={pad.left - 8} y={yy + 4} textAnchor="end">{formatNumber(value)}</text></g> })}
        {type === 'bar' ? points.map((point, index) => <rect className="chart-bar" key={index} x={x(index) - barWidth / 2} y={Math.min(y(point.value), baseline)} width={barWidth} height={Math.max(1, Math.abs(baseline - y(point.value)))}><title>{point.label}: {point.value}</title></rect>) : <><polyline className="chart-line" points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')} />{points.map((point, index) => <circle className="chart-point" key={index} cx={x(index)} cy={y(point.value)} r="3"><title>{point.label}: {point.value}</title></circle>)}</>}
        {points.map((point, index) => index % Math.max(1, Math.ceil(points.length / 14)) === 0 && <text className="chart-label" key={`label-${index}`} x={x(index)} y={height - pad.bottom + 18} textAnchor="end" transform={`rotate(-35 ${x(index)} ${height - pad.bottom + 18})`}>{point.label.slice(0, 18)}</text>)}
    </svg><span>Showing up to 100 rows.</span></div>
}

const formatNumber = (value: number) => Math.abs(value) >= 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : Number(value.toFixed(2)).toString()

function ResultComparison({ rows, total }: { rows: ReturnType<typeof compareResultRows>; total: number }) {
    const counts = { added: 0, removed: 0, changed: 0, equal: 0 }
    rows.forEach(row => { counts[row.status]++ })
    return <div className="result-comparison">
        <div className="comparison-summary"><span className="added">{counts.added} added</span><span className="removed">{counts.removed} removed</span><span className="changed">{counts.changed} changed</span><span>{total - counts.added - counts.removed - counts.changed} unchanged</span></div>
        <div className="comparison-result-list">{rows.map((row, index) => <div className={`comparison-result-row ${row.status}`} key={`${row.key}-${index}`}><span>{row.status}</span><strong>{row.key}</strong><div>{row.differences.map((difference, detailIndex) => <code key={detailIndex}>{difference}</code>)}</div></div>)}{!rows.length && <div className="results-empty">No differences.</div>}</div>
    </div>
}

function PivotTable({ pivot }: { pivot: ReturnType<typeof buildPivot> }) {
    return <div className="pivot-table-wrap"><table className="pivot-table"><thead><tr><th>Group</th>{pivot.columns.map(column => <th key={column}>{column}</th>)}<th>Total</th></tr></thead><tbody>{pivot.rows.map(row => <tr key={row.label}><th>{row.label}</th>{row.values.map((value, index) => <td key={index}>{value == null ? '-' : formatNumber(value)}</td>)}<td className="pivot-total">{row.total == null ? '-' : formatNumber(row.total)}</td></tr>)}</tbody></table>{!pivot.rows.length && <div className="results-empty">No rows to group.</div>}</div>
}
