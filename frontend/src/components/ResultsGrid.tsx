import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    DataEditor,
    EditListItem,
    GridCell,
    GridCellKind,
    GridColumn,
    GridSelection,
    Item,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import type { Column, Value } from '../ipc/types'
import { displayValue } from '../ipc/types'
import CellInspector from './CellInspector'
import ContextMenu, { MenuItem } from './ContextMenu'
import { Copy } from '../../wailsjs/go/api/App'
import { toCSV, toJSON, toSQL, toTSV } from '../export'
import { columnStatistics, distinctColumnValues, filterResultExpressionRows, filterResultRows, processResultRows, ResultFilter, ResultFilterExpression, resultFilterExpressionColumns, resultViewSorts, ResultViewState, toggleResultSort, withoutResultFilterExpressionColumn } from '../features/query/resultProcessing'
import { isBooleanColumn, isJsonColumn, temporalInputType } from '../features/tabledata/typedValues'
import { foreignKeyForColumn, ResultForeignKey } from '../features/query/foreignKeyResultActions'
import { ClipboardCopy, CopyPlus, Database, Download, ListTree, ReplaceAll, RotateCcw, Trash2 } from 'lucide-react'
import { loadResultColumnLayout, moveResultColumn, normalizeResultColumnLayout, ResultColumnLayout, resultColumnIds, resultColumnLayoutKey, resultVisibleColumnIndexes, saveResultColumnLayout } from '../features/query/resultColumnLayout'
import { selectedResultRowIndexes, selectResultRange, selectionStatistics } from '../features/query/resultSelection'
import ResultFindReplaceDialog from '../features/query/ResultFindReplaceDialog'
import QueryResultExportDialog from '../features/query/QueryResultExportDialog'
import DistinctValueFilterMenu from '../features/query/DistinctValueFilterMenu'
import ResultFilterPresetMenu from '../features/query/ResultFilterPresetMenu'
import { createResultFilterPreset, loadResultFilterPresets, ResultFilterPreset, saveResultFilterPresets } from '../features/query/resultFilterPresets'
import type { ResultFacetRequest, ResultFacetResult, ResultServerView } from '../features/query/serverResultView'
import AdvancedResultFilterDialog from '../features/query/AdvancedResultFilterDialog'
import ResultColumnLayoutControl from '../features/query/ResultColumnLayoutControl'
import ResultColumnFormatControl from '../features/query/ResultColumnFormatControl'
import { formatResultCell, type ResultColumnFormats } from '../features/query/resultColumnFormatting'

const FILTER_OPS = ['contains', '=', '!=', '<', '>', '<=', '>=', 'starts', 'is null', 'is not null']

interface Props {
    connId: string
    columns: Column[]
    rows: Value[][]
    editable?: boolean
    editedCells?: Set<string>
    insertedRows?: Set<number>
    deletedRows?: Set<number>
    columnDetails?: Array<{ name: string; typeName: string; nullable: boolean }>
    foreignKeys?: ResultForeignKey[]
    sqlTable?: string
    sqlEngine?: string
    exportBaseName?: string
    truncated?: boolean
    onCellsEdit?: (edits: Array<{ rowIndex: number; columnIndex: number; text: string; isNull: boolean }>) => void
    onToggleDeleteRow?: (rowIndex: number) => void
    onOpenTypedEditor?: (rowIndex: number, columnIndex: number) => void
    onNavigateForeignKey?: (foreignKey: ResultForeignKey, referencedColumn: string, value: string) => void
    onOpenForeignKeyLookup?: (foreignKey: ResultForeignKey, rowIndex: number) => void
    onDuplicateRows?: (rowIndexes: number[]) => void
    onSetRowsDeleted?: (rowIndexes: number[], deleted: boolean) => void
    onServerViewChange?: (view: ResultServerView) => void
    serverViewBusy?: boolean
    serverViewActive?: boolean
    loadServerFacet?: (request: ResultFacetRequest) => Promise<ResultFacetResult>
    initialViewState?: ResultViewState
    onViewStateChange?: (view: ResultViewState) => void
    initialColumnLayout?: ResultColumnLayout
    onColumnLayoutChange?: (layout: ResultColumnLayout) => void
    columnFormats?: ResultColumnFormats
    onColumnFormatsChange?: (formats: ResultColumnFormats) => void
}

export default function ResultsGrid({ connId, columns, rows, editable = false, editedCells = new Set(), insertedRows = new Set(), deletedRows = new Set(), columnDetails = [], foreignKeys = [], sqlTable, sqlEngine = 'postgres', exportBaseName = 'query-result', truncated = false, onCellsEdit, onToggleDeleteRow, onOpenTypedEditor, onNavigateForeignKey, onOpenForeignKeyLookup, onDuplicateRows, onSetRowsDeleted, onServerViewChange, serverViewBusy = false, serverViewActive = false, loadServerFacet, initialViewState, onViewStateChange, initialColumnLayout, onColumnLayoutChange, columnFormats = {}, onColumnFormatsChange }: Props) {
    const wrap = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ w: 0, h: 0 })
    const [inspect, setInspect] = useState<{ column: string; cell: Value } | null>(null)
    const [search, setSearch] = useState(initialViewState?.search ?? '')
    const [widths, setWidths] = useState<Record<string, number>>({})
    const [menu, setMenu] = useState<{ x: number; y: number; col: number; row: number } | null>(null)
    const [sorts, setSorts] = useState(() => resultViewSorts(initialViewState ?? { filters: [], search: '', sort: null }))
    const [filters, setFilters] = useState<ResultFilter[]>(() => initialViewState?.filters.map(filter => ({ ...filter })) ?? [])
    const [filterColumn, setFilterColumn] = useState(0)
    const [filterOp, setFilterOp] = useState('contains')
    const [filterValue, setFilterValue] = useState('')
    const [statsColumn, setStatsColumn] = useState(0)
    const [copyMenuOpen, setCopyMenuOpen] = useState(false)
    const [selection, setSelection] = useState<GridSelection | undefined>(undefined)
    const [showReplace, setShowReplace] = useState(false)
    const [showExport, setShowExport] = useState(false)
    const [headerMenu, setHeaderMenu] = useState<{ displayedColumn: number; x: number; y: number } | null>(null)
    const [savedLayouts, setSavedLayouts] = useState<Record<string, ResultColumnLayout>>({})
    const [filterPresets, setFilterPresets] = useState<ResultFilterPreset[]>([])
    const [facetSearch, setFacetSearch] = useState('')
    const [serverFacet, setServerFacet] = useState<{ column: number; result: ResultFacetResult } | null>(null)
    const [serverFacetLoading, setServerFacetLoading] = useState(false)
    const [filterExpression, setFilterExpression] = useState<ResultFilterExpression | null>(() => initialViewState?.expression ? { ...initialViewState.expression, groups: initialViewState.expression.groups.map(group => ({ ...group, filters: group.filters.map(filter => ({ ...filter })) })) } : null)
    const [showAdvancedFilter, setShowAdvancedFilter] = useState(false)
    const lastServerView = useRef(JSON.stringify({ filters: initialViewState?.filters ?? [], expression: initialViewState?.expression ?? null, search: initialViewState?.search.trim() ?? '', sort: resultViewSorts(initialViewState ?? { filters: [], search: '', sort: null })[0] ?? null, sorts: resultViewSorts(initialViewState ?? { filters: [], search: '', sort: null }) }))
    const editedCellBackground = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? '#413815' : '#fff4cc'
    const insertedCellBackground = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? '#173d24' : '#e8f8ed'
    const deletedCellBackground = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? '#482120' : '#ffebe9'
    const columnIds = useMemo(() => resultColumnIds(columns), [columns])
    const layoutKey = useMemo(() => resultColumnLayoutKey(connId, columns), [columns, connId])
    const previousLayoutKey = useRef(layoutKey)
    const storedLayout = useMemo(() => typeof window === 'undefined' ? null : loadResultColumnLayout(layoutKey), [layoutKey])
    const layout = useMemo(() => normalizeResultColumnLayout(savedLayouts[layoutKey] ?? initialColumnLayout ?? storedLayout, columnIds), [columnIds, initialColumnLayout, layoutKey, savedLayouts, storedLayout])
    const visibleColumnIndexes = useMemo(() => resultVisibleColumnIndexes(layout, columnIds), [columnIds, layout])
    const updateLayout = useCallback((next: ResultColumnLayout) => {
        const normalized = normalizeResultColumnLayout(next, columnIds)
        setSavedLayouts(current => ({ ...current, [layoutKey]: normalized }))
        setSelection(undefined); setCopyMenuOpen(false); setHeaderMenu(null)
        if (typeof window !== 'undefined') saveResultColumnLayout(layoutKey, normalized)
        onColumnLayoutChange?.(normalized)
    }, [columnIds, layoutKey, onColumnLayoutChange])
    useEffect(() => {
        const layoutChanged = previousLayoutKey.current !== layoutKey
        previousLayoutKey.current = layoutKey
        if (!onViewStateChange || layoutChanged) { setFilters([]); setFilterExpression(null) }
        if (layoutChanged) { setSearch(''); setSorts([]) }
        setFilterPresets(typeof window === 'undefined' ? [] : loadResultFilterPresets(layoutKey))
    }, [layoutKey, onViewStateChange])

    useEffect(() => {
        const el = wrap.current
        if (!el) return
        const ro = new ResizeObserver(entries => {
            const r = entries[0].contentRect
            setSize({ w: Math.floor(r.width), h: Math.floor(r.height) })
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    useEffect(() => {
        const last = Math.max(0, columns.length - 1)
        setFilterColumn(column => Math.min(column, last))
        setStatsColumn(column => Math.min(column, last))
        setFilters(current => current.filter(filter => filter.column <= last))
        setSorts(current => current.filter(sort => sort.column <= last))
        setSelection(undefined); setCopyMenuOpen(false)
    }, [columns])
    useEffect(() => { setSelection(undefined); setCopyMenuOpen(false) }, [rows.length])

    // Text search filters the loaded rows to those with a cell containing the
    // query (case-insensitive) — DataGrip-style find within the result set.
    const shownRows = useMemo(() => {
        return processResultRows(rows, { filters, expression: filterExpression, search, sort: sorts[0] ?? null, sorts })
    }, [filterExpression, filters, rows, search, sorts])
    const serverView = useMemo<ResultServerView>(() => ({ filters, expression: filterExpression, search: search.trim(), sort: sorts[0] ?? null, sorts, analysisLimit: initialViewState?.analysisLimit ?? null }), [filterExpression, filters, initialViewState?.analysisLimit, search, sorts])
    const serverViewKey = JSON.stringify(serverView)
    useEffect(() => { onViewStateChange?.(serverView) }, [onViewStateChange, serverView])
    useEffect(() => {
        if (!onServerViewChange || serverViewBusy || serverViewKey === lastServerView.current) return
        const timer = window.setTimeout(() => {
            lastServerView.current = serverViewKey
            onServerViewChange(serverView)
        }, 300)
        return () => window.clearTimeout(timer)
    }, [onServerViewChange, serverView, serverViewBusy, serverViewKey])
    const statistics = useMemo(() => columnStatistics(shownRows, statsColumn), [shownRows, statsColumn])
    const headerSourceColumn = headerMenu ? visibleColumnIndexes[headerMenu.displayedColumn] : -1
    const localHeaderValues = useMemo(() => {
        if (headerSourceColumn < 0) return []
        let facetRows = filterResultRows(rows, filters.filter(filter => filter.column !== headerSourceColumn))
        facetRows = filterResultExpressionRows(facetRows, withoutResultFilterExpressionColumn(filterExpression, headerSourceColumn))
        if (search.trim()) facetRows = facetRows.filter(row => row.some(cell => cell && cell.t !== 'null' && String(cell.v ?? '').toLowerCase().includes(search.toLowerCase())))
        return distinctColumnValues(facetRows, headerSourceColumn)
    }, [filterExpression, filters, headerSourceColumn, rows, search])
    useEffect(() => {
        if (!loadServerFacet || headerSourceColumn < 0) { setServerFacet(null); setServerFacetLoading(false); return }
        let ignored = false
        setServerFacetLoading(true)
        loadServerFacet({ view: serverView, column: headerSourceColumn, search: facetSearch }).then(result => {
            if (!ignored) setServerFacet({ column: headerSourceColumn, result })
        }).catch(() => {
            if (!ignored) setServerFacet(null)
        }).finally(() => {
            if (!ignored) setServerFacetLoading(false)
        })
        return () => { ignored = true }
    }, [facetSearch, headerSourceColumn, loadServerFacet, serverView, serverViewKey])
    const headerValues = serverFacet?.column === headerSourceColumn ? serverFacet.result.values : localHeaderValues
    const selectedRange = useMemo(() => selectResultRange(columns, shownRows, visibleColumnIndexes, selection?.current?.range), [columns, selection, shownRows, visibleColumnIndexes])
    const selectedStatistics = useMemo(() => selectedRange ? selectionStatistics(selectedRange.rows) : null, [selectedRange])
    const sourceRowIndexes = useMemo(() => shownRows.map(row => rows.indexOf(row)), [rows, shownRows])
    const replaceSelection = useMemo(() => ({
        ranges: selection?.current ? [selection.current.range, ...selection.current.rangeStack] : [],
        rows: selection?.rows.toArray() ?? [],
        columns: selection?.columns.toArray() ?? [],
    }), [selection])
    const selectedSourceRows = useMemo(() => {
        const ranges = selection?.current ? [selection.current.range, ...selection.current.rangeStack] : []
        return selectedResultRowIndexes(selection?.rows.toArray() ?? [], ranges).flatMap(displayedRow => {
            const sourceRow = sourceRowIndexes[displayedRow]
            return sourceRow >= 0 ? [sourceRow] : []
        })
    }, [selection, sourceRowIndexes])
    useEffect(() => { if (!selectedRange) setCopyMenuOpen(false) }, [selectedRange])
    const copySelection = (format: 'csv' | 'tsv' | 'json' | 'sql') => {
        if (!selectedRange) return
        const content = format === 'csv' ? toCSV(selectedRange.columns, selectedRange.rows)
            : format === 'tsv' ? toTSV(selectedRange.columns, selectedRange.rows)
                : format === 'json' ? toJSON(selectedRange.columns, selectedRange.rows)
                    : toSQL(sqlTable ?? 'result', selectedRange.columns, selectedRange.rows, sqlEngine)
        void Copy(content); setCopyMenuOpen(false)
    }
    const addFilter = () => {
        if (!columns.length || (!filterOp.includes('null') && !filterValue)) return
        setFilters(current => [...current, { column: filterColumn, op: filterOp, value: filterValue }])
        setFilterValue('')
    }
    const updateFilterPresets = (next: ResultFilterPreset[]) => {
        setFilterPresets(next)
        if (typeof window !== 'undefined') saveResultFilterPresets(layoutKey, next)
    }
    const filterLabel = (filter: ResultFilter) => {
        if (filter.op !== 'in') return `${columns[filter.column]?.name} ${filter.op}${filter.value ? ` ${filter.value}` : ''}`
        const count = (filter.values?.length ?? 0) + (filter.includeNull ? 1 : 0)
        return `${columns[filter.column]?.name} in (${count} values)`
    }

    const advancedFilterColumns = useMemo(() => resultFilterExpressionColumns(filterExpression), [filterExpression])
    const advancedFilterCount = filterExpression?.groups.reduce((count, group) => count + group.filters.length, 0) ?? 0
    const gridColumns: GridColumn[] = visibleColumnIndexes.map(sourceIndex => {
        const column = columns[sourceIndex]
        const id = columnIds[sourceIndex]
        return {
            id,
            title: column.name + (() => { const priority = sorts.findIndex(sort => sort.column === sourceIndex); return priority < 0 ? '' : ` ${sorts[priority].descending ? '↓' : '↑'}${priority + 1}` })(),
            width: widths[id] ?? Math.min(Math.max(column.name.length * 9 + 24, 90), 260),
            hasMenu: true,
            style: filters.some(filter => filter.column === sourceIndex) || advancedFilterColumns.has(sourceIndex) ? 'highlight' : 'normal',
        }
    })

    const cellMenuItems = (col: number, row: number): MenuItem[] => {
        const sourceCol = visibleColumnIndexes[col]
        const cell = shownRows[row]?.[sourceCol]
        const sourceRow = rows.indexOf(shownRows[row])
        const column = columns[sourceCol]?.name ?? ''
        const detail = columnDetails.find(item => item.name === column)
        const foreignKey = foreignKeyForColumn(foreignKeys, column)
        const referencedColumn = foreignKey?.referencedColumns[foreignKey.columns.indexOf(column)]
        const text = !cell || cell.t === 'null' ? '' : displayValue(cell)
        const items: MenuItem[] = [
            { label: 'Copy value', onClick: () => Copy(text) },
            { label: 'Copy row (CSV)', onClick: () => Copy(toCSV(visibleColumnIndexes.map(index => columns[index]), [visibleColumnIndexes.map(index => shownRows[row]?.[index] ?? { t: 'null' })])) },
            {
                label: `Go to referenced row${foreignKey ? ` in ${foreignKey.referencedTable}` : ''}`,
                disabled: !foreignKey || !referencedColumn || !onNavigateForeignKey || !cell || cell.t === 'null',
                onClick: () => foreignKey && referencedColumn && onNavigateForeignKey?.(foreignKey, referencedColumn, text),
            },
            { label: 'Inspect value…', onClick: () => setInspect({ column, cell: cell ?? { t: 'null' } }) },
        ]
        if (editable && sourceRow >= 0) {
            items.push({ label: '', onClick: () => {}, separator: true })
            if (foreignKey && onOpenForeignKeyLookup) items.push({ label: `Choose referenced value…`, disabled: deletedRows.has(sourceRow), onClick: () => onOpenForeignKeyLookup(foreignKey, sourceRow) })
            const typed = !!cell && (isJsonColumn(detail?.typeName ?? columns[sourceCol]?.typeName ?? '', cell.t) || !!temporalInputType(detail?.typeName ?? columns[sourceCol]?.typeName ?? '', cell.t) || isBooleanColumn(detail?.typeName ?? columns[sourceCol]?.typeName ?? '', cell.t))
            if (typed && onOpenTypedEditor) items.push({ label: isJsonColumn(detail?.typeName ?? '', cell?.t ?? '') ? 'Edit JSON…' : isBooleanColumn(detail?.typeName ?? '', cell?.t ?? '') ? 'Edit boolean…' : 'Edit date/time…', disabled: deletedRows.has(sourceRow), onClick: () => onOpenTypedEditor(sourceRow, sourceCol) })
            if (onCellsEdit) items.push({ label: 'Set NULL', disabled: deletedRows.has(sourceRow) || !detail?.nullable, onClick: () => onCellsEdit([{ rowIndex: sourceRow, columnIndex: sourceCol, text: '', isNull: true }]) })
            if (onToggleDeleteRow) items.push({ label: deletedRows.has(sourceRow) ? 'Restore row' : 'Delete row', danger: !deletedRows.has(sourceRow), onClick: () => onToggleDeleteRow(sourceRow) })
        }
        items.push({ label: '', onClick: () => {}, separator: true }, { label: `Pin through ${column}`, onClick: () => updateLayout({ ...layout, frozen: col + 1 }) })
        if (layout.frozen > 0) items.push({ label: 'Unpin all columns', onClick: () => updateLayout({ ...layout, frozen: 0 }) })
        return items
    }

    const getCellContent = useCallback(
        ([col, row]: Item): GridCell => {
            const sourceCol = visibleColumnIndexes[col]
            const cell = shownRows[row]?.[sourceCol]
            const sourceRow = rows.indexOf(shownRows[row])
            const changed = editedCells.has(`${sourceRow}:${sourceCol}`)
            const inserted = insertedRows.has(sourceRow)
            const deleted = deletedRows.has(sourceRow)
            const background = deleted ? deletedCellBackground : changed ? editedCellBackground : inserted ? insertedCellBackground : undefined
            if (!cell) {
                return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false }
            }
            const format = columnFormats[columnIds[sourceCol]]
            const text = formatResultCell(cell, columns[sourceCol], format)
            const typeName = columnDetails.find(item => item.name === columns[sourceCol]?.name)?.typeName ?? columns[sourceCol]?.typeName ?? ''
            if (cell.t !== 'null' && isBooleanColumn(typeName, cell.t) && format?.boolean !== 'yes-no') {
                return {
                    kind: GridCellKind.Boolean,
                    data: cell.t === 'null' ? false : cell.v === true || String(cell.v).toLowerCase() === 'true' || String(cell.v) === '1',
                    allowOverlay: false,
                    readonly: !editable || deleted,
                    themeOverride: background ? { bgCell: background } : undefined,
                }
            }
            if (cell.t === 'i64' || cell.t === 'f64') {
                return {
                    kind: GridCellKind.Number,
                    data: typeof cell.v === 'number' ? cell.v : undefined,
                    displayData: text,
                    allowOverlay: true,
                    readonly: !editable || deleted,
                    themeOverride: background ? { bgCell: background } : undefined,
                }
            }
            return {
                kind: GridCellKind.Text,
                data: cell.t === 'null' ? '' : text,
                displayData: text.slice(0, 512),
                allowOverlay: true,
                readonly: !editable || deleted,
                themeOverride: background ? { bgCell: background } : cell.t === 'null' ? { textDark: '#8a8a90' } : undefined,
            }
        },
        [columnDetails, columnFormats, columnIds, columns, deletedCellBackground, deletedRows, editable, editedCellBackground, editedCells, insertedCellBackground, insertedRows, rows, shownRows, visibleColumnIndexes],
    )

    const onCellsEdited = useCallback((values: readonly EditListItem[]) => {
        if (!editable || !onCellsEdit) return false
        const edits = values.flatMap(({ location: [col, row], value }) => {
            const sourceRow = rows.indexOf(shownRows[row])
            const sourceCol = visibleColumnIndexes[col]
            if (sourceRow < 0 || deletedRows.has(sourceRow)) return []
            let text: string
            if (value.kind === GridCellKind.Text) text = value.data
            else if (value.kind === GridCellKind.Number) text = String(value.data)
            else if (value.kind === GridCellKind.Boolean) text = value.data ? 'true' : 'false'
            else return []
            return [{ rowIndex: sourceRow, columnIndex: sourceCol, text, isNull: text === '' }]
        })
        if (edits.length) onCellsEdit(edits)
        return true
    }, [deletedRows, editable, onCellsEdit, rows, shownRows, visibleColumnIndexes])

    // Double-clicking a cell opens the inspector — the only way to read a
    // truncated oversized value in full.
    const onCellActivated = useCallback(
        ([col, row]: Item) => {
            const sourceCol = visibleColumnIndexes[col]
            const cell = shownRows[row]?.[sourceCol]
            if (cell && (!editable || cell.ref)) setInspect({ column: columns[sourceCol]?.name ?? '', cell })
        },
        [shownRows, columns, editable, visibleColumnIndexes],
    )

    return (
        <div className="results-grid-wrap">
            <div className="grid-searchbar">
                <input
                    className="grid-search"
                    placeholder="🔍 Search results…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                {search && (
                    <span className="grid-search-count">
                        {shownRows.length.toLocaleString()} of {rows.length.toLocaleString()}
                    </span>
                )}
                <span className="tb-sep" />
                <select value={filterColumn} onChange={event => setFilterColumn(Number(event.target.value))} aria-label="Filter column">{columns.map((column, index) => <option value={index} key={`${column.name}-${index}`}>{column.name}</option>)}</select>
                <select value={filterOp} onChange={event => setFilterOp(event.target.value)} aria-label="Filter operator">{FILTER_OPS.map(op => <option key={op}>{op}</option>)}</select>
                {!filterOp.includes('null') && <input className="result-filter-value" value={filterValue} onChange={event => setFilterValue(event.target.value)} onKeyDown={event => event.key === 'Enter' && addFilter()} placeholder="value" />}
                <button onClick={addFilter} disabled={!columns.length || (!filterOp.includes('null') && !filterValue)}>Add</button>
                {filters.map((filter, index) => <button className="result-filter-chip" key={index} onClick={() => setFilters(current => current.filter((_, itemIndex) => itemIndex !== index))} title="Remove filter">{filterLabel(filter)} ×</button>)}
                {filterExpression && <button className="result-filter-chip" onClick={() => setFilterExpression(null)} title="Remove advanced filter">Advanced · {advancedFilterCount} rules ×</button>}
                <button className={`icon-btn ${filterExpression ? 'active' : ''}`} onClick={() => setShowAdvancedFilter(true)} title="Advanced result filter"><ListTree size={13} /></button>
                <ResultFilterPresetMenu presets={filterPresets} filters={filters} expression={filterExpression} onSave={name => updateFilterPresets([...filterPresets, createResultFilterPreset(name, filters, filterExpression)])} onApply={preset => { setFilters(preset.filters.map(filter => ({ ...filter, values: filter.values ? [...filter.values] : undefined }))); setFilterExpression(preset.expression ? { ...preset.expression, groups: preset.expression.groups.map(group => ({ ...group, filters: group.filters.map(filter => ({ ...filter })) })) } : null) }} onDelete={id => updateFilterPresets(filterPresets.filter(preset => preset.id !== id))} onClear={() => { setFilters([]); setFilterExpression(null) }} />
                {(onServerViewChange || serverViewActive) && <span className={`result-server-view ${serverViewBusy ? 'busy' : ''}`} title={serverViewBusy ? 'Refreshing filtered rows from the database' : 'Filters and sorting apply at the database'}><Database size={12} /></span>}
                {editable && selectedSourceRows.length > 0 && <div className="result-row-actions"><span>{selectedSourceRows.length} rows</span><button className="icon-btn" disabled={!onDuplicateRows || selectedSourceRows.every(row => deletedRows.has(row))} onClick={() => onDuplicateRows?.(selectedSourceRows)} title="Duplicate selected rows"><CopyPlus size={13} /></button><button className="icon-btn" disabled={!onSetRowsDeleted || selectedSourceRows.every(row => deletedRows.has(row))} onClick={() => onSetRowsDeleted?.(selectedSourceRows, true)} title="Delete selected rows"><Trash2 size={13} /></button><button className="icon-btn" disabled={!onSetRowsDeleted || selectedSourceRows.every(row => !deletedRows.has(row))} onClick={() => onSetRowsDeleted?.(selectedSourceRows, false)} title="Restore selected rows"><RotateCcw size={13} /></button></div>}
                <button className="icon-btn result-export-control" onClick={() => setShowExport(true)} disabled={!rows.length} title="Export query result"><Download size={13} /></button>
                {editable && onCellsEdit && <button className="icon-btn result-replace-control" onClick={() => setShowReplace(true)} disabled={!shownRows.length} title="Find and replace in loaded results"><ReplaceAll size={13} /></button>}
                <div className="result-copy-control">
                    <button className={`icon-btn ${copyMenuOpen ? 'active' : ''}`} disabled={!selectedRange} onClick={() => setCopyMenuOpen(open => !open)} title="Copy selected range"><ClipboardCopy size={13} /></button>
                    {copyMenuOpen && selectedRange && <div className="result-copy-menu"><div><strong>{selectedRange.rows.length} rows × {selectedRange.columns.length} columns</strong><span>{selectedRange.cellCount.toLocaleString()} selected cells</span></div><button onClick={() => copySelection('csv')}>CSV with headers</button><button onClick={() => copySelection('tsv')}>TSV with headers</button><button onClick={() => copySelection('json')}>JSON objects</button><button disabled={!sqlTable} onClick={() => copySelection('sql')} title={sqlTable ? `INSERT statements for ${sqlTable}` : 'SQL copy requires a single-table result'}>SQL INSERT</button></div>}
                </div>
                <ResultColumnLayoutControl columns={columns} columnIds={columnIds} layout={layout} presetContextKey={layoutKey} onChange={updateLayout} onOpen={() => setCopyMenuOpen(false)} onReset={() => setWidths({})} />
                {onColumnFormatsChange && <ResultColumnFormatControl columns={columns} columnIds={columnIds} formats={columnFormats} onChange={onColumnFormatsChange} onOpen={() => setCopyMenuOpen(false)} />}
            </div>
            <div className="results-grid" ref={wrap}>
                {size.w > 0 && gridColumns.length > 0 && (
                    <DataEditor
                        width={size.w}
                        height={size.h}
                        columns={gridColumns}
                        rows={shownRows.length}
                        getCellContent={getCellContent}
                        gridSelection={selection}
                        onGridSelectionChange={next => { setSelection(next); setCopyMenuOpen(false) }}
                        onCellsEdited={onCellsEdited}
                        onPaste={editable}
                        fillHandle={editable}
                        onCellActivated={onCellActivated}
                        onColumnResize={(col, newSize) => setWidths(w => ({ ...w, [col.id ?? '']: newSize }))}
                        onColumnMoved={(start, end) => updateLayout(moveResultColumn(layout, start, end))}
                        freezeColumns={layout.frozen}
                        onHeaderClicked={(column, event) => { const sourceColumn = visibleColumnIndexes[column]; setSorts(current => toggleResultSort(current, sourceColumn, event.shiftKey || event.metaKey || event.ctrlKey)) }}
                        onHeaderMenuClick={(displayedColumn, bounds) => { setFacetSearch(''); setServerFacet(null); setHeaderMenu({ displayedColumn, x: bounds.x, y: bounds.y + bounds.height }) }}
                        onCellContextMenu={([col, row], e) => {
                            e.preventDefault()
                            const rect = wrap.current?.getBoundingClientRect()
                            setMenu({
                                x: (rect?.left ?? 0) + e.bounds.x + e.localEventX,
                                y: (rect?.top ?? 0) + e.bounds.y + e.localEventY,
                                col,
                                row,
                            })
                        }}
                        rowMarkers="number"
                        smoothScrollX
                        smoothScrollY
                        getCellsForSelection={true}
                    />
                )}
            </div>
            <div className="result-statsbar">{selectedRange && selectedStatistics ? <><span>Selection <strong>{selectedRange.rows.length} × {selectedRange.columns.length}</strong></span><span>Count <strong>{selectedStatistics.count.toLocaleString()}</strong></span><span>NULL <strong>{selectedStatistics.nulls.toLocaleString()}</strong></span><span>Distinct <strong>{selectedStatistics.distinct.toLocaleString()}</strong></span>{selectedStatistics.numericCount > 0 && <><span>Sum <strong>{formatStat(selectedStatistics.sum)}</strong></span><span>Average <strong>{formatStat(selectedStatistics.sum / selectedStatistics.numericCount)}</strong></span><span>Min <strong>{formatStat(selectedStatistics.min!)}</strong></span><span>Max <strong>{formatStat(selectedStatistics.max!)}</strong></span></>}</> : <><label>Statistics<select value={statsColumn} onChange={event => setStatsColumn(Number(event.target.value))}>{columns.map((column, index) => <option value={index} key={`${column.name}-${index}`}>{column.name}</option>)}</select></label><span>Count <strong>{statistics.count.toLocaleString()}</strong></span><span>NULL <strong>{statistics.nulls.toLocaleString()}</strong></span><span>Distinct <strong>{statistics.distinct.toLocaleString()}</strong></span>{statistics.numericCount > 0 && <><span>Sum <strong>{formatStat(statistics.sum)}</strong></span><span>Average <strong>{formatStat(statistics.sum / statistics.numericCount)}</strong></span><span>Min <strong>{formatStat(statistics.min!)}</strong></span><span>Max <strong>{formatStat(statistics.max!)}</strong></span></>}</>}</div>
            {menu && (
                <ContextMenu x={menu.x} y={menu.y} items={cellMenuItems(menu.col, menu.row)} onClose={() => setMenu(null)} />
            )}
            {headerMenu && headerSourceColumn >= 0 && <DistinctValueFilterMenu x={headerMenu.x} y={headerMenu.y} column={columns[headerSourceColumn]?.name ?? ''} values={headerValues} activeFilters={filters.filter(filter => filter.column === headerSourceColumn)} loading={serverFacetLoading} limited={serverFacet?.column === headerSourceColumn && serverFacet.result.limited} onSearchChange={loadServerFacet ? setFacetSearch : undefined} onApply={selected => {
                const values = selected.filter(value => !value.isNull).map(value => value.value)
                const includeNull = selected.some(value => value.isNull)
                const next: ResultFilter = selected.length === 1
                    ? includeNull ? { column: headerSourceColumn, op: 'is null', value: '' } : { column: headerSourceColumn, op: '=', value: values[0] }
                    : { column: headerSourceColumn, op: 'in', value: '', values, includeNull }
                setFilters(current => [...current.filter(filter => filter.column !== headerSourceColumn), next]); setFilterExpression(current => withoutResultFilterExpressionColumn(current, headerSourceColumn)); setHeaderMenu(null)
            }} onClear={() => { setFilters(current => current.filter(filter => filter.column !== headerSourceColumn)); setFilterExpression(current => withoutResultFilterExpressionColumn(current, headerSourceColumn)); setHeaderMenu(null) }} onClose={() => setHeaderMenu(null)} />}
            {inspect && (
                <CellInspector
                    connId={connId}
                    column={inspect.column}
                    cell={inspect.cell}
                    onClose={() => setInspect(null)}
                />
            )}
            {showReplace && onCellsEdit && <ResultFindReplaceDialog columns={columns} rows={shownRows} sourceRowIndexes={sourceRowIndexes} visibleColumnIndexes={visibleColumnIndexes} excludedSourceRows={deletedRows} selection={replaceSelection} onCancel={() => setShowReplace(false)} onApply={changes => { onCellsEdit(changes); setShowReplace(false) }} />}
            {showExport && <QueryResultExportDialog baseName={exportBaseName} columns={columns} rows={rows} shownRows={shownRows} visibleColumnIndexes={visibleColumnIndexes} selection={selection?.current?.range} sqlTable={sqlTable} engine={sqlEngine} truncated={truncated} onClose={() => setShowExport(false)} />}
            {showAdvancedFilter && <AdvancedResultFilterDialog columns={columns} filters={filters} expression={filterExpression} engine={sqlEngine} onCancel={() => setShowAdvancedFilter(false)} onApply={expression => { setFilterExpression(expression); setShowAdvancedFilter(false) }} />}
        </div>
    )
}

const formatStat = (value: number) => Number(value.toPrecision(10)).toLocaleString()

// results-grid-wrap wraps the search bar + grid; keep the grid filling the rest.
