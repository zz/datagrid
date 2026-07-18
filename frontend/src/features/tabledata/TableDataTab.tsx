import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    DataEditor,
    EditableGridCell,
    GridCell,
    GridCellKind,
    GridColumn,
    GridSelection,
    Item,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { useApp, Tab } from '../../store'
import { useSettings } from '../../settings'
import type { Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'
import { drivers } from '../../../wailsjs/go/models'
import { Copy } from '../../../wailsjs/go/api/App'
import { toCSV } from '../../export'
import ImportDialog from './ImportDialog'
import CopyButton from '../../components/CopyButton'
import ContextMenu, { gridContextMenuCoordinates, MenuItem } from '../../components/ContextMenu'
import CellInspector from '../../components/CellInspector'
import ColumnFilterInput from '../../components/ColumnFilterInput'
import TableDetails, { TableDetailSection } from './TableDetails'
import TypedCellEditor from './TypedCellEditor'
import { isJsonColumn, temporalInputType } from './typedValues'
import { ArrowRightLeft, Code2, Columns3, DatabaseZap, ListChecks, Redo2, TriangleAlert, Undo2 } from 'lucide-react'
import ExportDialog from './ExportDialog'
import DdlSourceView from '../ddl/DdlSourceView'
import SchemaMigrationEditor from '../ddl/SchemaMigrationEditor'
import TableComparison from '../ddl/TableComparison'
import ERDiagram from '../diagram/ERDiagram'
import DependencyAnalysis from '../diagram/DependencyAnalysis'
import TestDataDialog from './TestDataDialog'
import DataTransferDialog from './DataTransferDialog'
import SQLGeneratorDialog from '../query/SQLGeneratorDialog'
import TableChangesDialog from './TableChangesDialog'

const FILTER_OPS = ['contains', '=', '!=', '<', '>', '<=', '>=', 'starts']

export default function TableDataTab({ tab }: { tab: Tab }) {
    const view = useApp(s => s.tableViews[tab.id])
    const conn = useApp(s => s.connections.find(c => c.id === tab.connId))
    const PAGE_SIZE = useSettings(s => s.pageSize)
    const {
        setConnectionReadOnly,
        setTableSort,
        setTableFilters,
        setTableWhere,
        setTablePage,
        setColWidth,
        setColumnVisible,
        showAllColumns,
        stageEdit,
        stageEditBatch,
        stageInsert,
        stageDuplicate,
        stageDelete,
        stageDeleteBatch,
        undoTableEdit,
        redoTableEdit,
        revertTableEdit,
        openTableWithFilter,
        discardEdits,
        applyEdits,
        dismissEditConflicts,
        reloadTable,
        setError,
    } = useApp()
    const wrap = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ w: 0, h: 0 })
    const [selection, setSelection] = useState<GridSelection | undefined>(undefined)
    const [search, setSearch] = useState('')
    const [fillValue, setFillValue] = useState('')
    const [showImport, setShowImport] = useState(false)
    const [showExport, setShowExport] = useState(false)
    const [showGenerate, setShowGenerate] = useState(false)
    const [showTransfer, setShowTransfer] = useState(false)
    const [showSQLGenerator, setShowSQLGenerator] = useState(false)
    const [confirmRefresh, setConfirmRefresh] = useState(false)
    const [showChanges, setShowChanges] = useState(false)
    const [whereDraft, setWhereDraft] = useState('')
    const [menu, setMenu] = useState<{ x: number; y: number; col: number; row: number } | null>(null)
    const [inspect, setInspect] = useState<{ column: string; cell: Value } | null>(null)
    const [typedEdit, setTypedEdit] = useState<{
        rowIndex: number
        column: string
        columnType: string
        cell: Value
    } | null>(null)
    const [detailSection, setDetailSection] = useState<'data' | TableDetailSection | 'ddl' | 'modify' | 'compare' | 'diagram' | 'dependencies'>('data')
    const [columnPickerOpen, setColumnPickerOpen] = useState(false)
    const activeTabId = useApp(state => state.activeTabId)
    // Filter-bar draft.
    const [fCol, setFCol] = useState('')
    const [fOp, setFOp] = useState('contains')
    const [fVal, setFVal] = useState('')

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

    useEffect(() => setSelection(undefined), [view?.hiddenColumns])

    useEffect(() => {
        if (activeTabId !== tab.id || detailSection !== 'data') return
        const onKey = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
            event.preventDefault()
            if (event.shiftKey) redoTableEdit(tab.id)
            else undoTableEdit(tab.id)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [activeTabId, detailSection, redoTableEdit, tab.id, undoTableEdit])

    const readOnly = !!conn?.readOnly
    // A read-only connection blocks all edits; a missing PK/unique key means we
    // can't target a row. Editing needs both a key and a writable connection.
    const editable = !!view?.info && view.info.primaryKey.length > 0 && !readOnly
    const visibleColumnIndexes = useMemo(
        () => (view?.columns ?? []).map((_, index) => index).filter(index => !view?.hiddenColumns.includes(view.columns[index].name)),
        [view?.columns, view?.hiddenColumns],
    )

    // Client-side text search over the loaded page. shownIndex maps a grid
    // row back to its index in view.rows so edits still target the right row.
    const { shownRows, shownIndex } = useMemo(() => {
        const rows = view?.rows ?? []
        if (search.trim() === '') return { shownRows: rows, shownIndex: rows.map((_, i) => i) }
        const q = search.toLowerCase()
        const keptRows: Value[][] = []
        const keptIdx: number[] = []
        rows.forEach((r, i) => {
            if (r.some(c => c && c.t !== 'null' && String(c.v ?? '').toLowerCase().includes(q))) {
                keptRows.push(r)
                keptIdx.push(i)
            }
        })
        return { shownRows: keptRows, shownIndex: keptIdx }
    }, [view?.rows, search])

    const getCellContent = useCallback(
        ([col, row]: Item): GridCell => {
            const sourceCol = visibleColumnIndexes[col]
            const cell = shownRows[row]?.[sourceCol]
            if (!cell) {
                return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: editable }
            }
            const text = cell.t === 'null' ? '' : displayValue(cell)
            if (cell.t === 'bool') {
                return {
                    kind: GridCellKind.Boolean,
                    data: Boolean(cell.v),
                    allowOverlay: false,
                    readonly: !editable,
                }
            }
            if ((cell.t === 'i64' || cell.t === 'f64') && Number.isFinite(Number(cell.v))) {
                return {
                    kind: GridCellKind.Number,
                    data: Number(cell.v),
                    displayData: text,
                    allowOverlay: editable,
                    readonly: !editable,
                }
            }
            return {
                kind: GridCellKind.Text,
                data: text,
                displayData: cell.t === 'null' ? 'NULL' : text.slice(0, 512),
                allowOverlay: editable,
                readonly: !editable,
                themeOverride: cell.t === 'null' ? { textDark: '#8a8a90' } : undefined,
            }
        },
        [shownRows, editable, visibleColumnIndexes],
    )

    const onCellEdited = useCallback(
        ([col, row]: Item, newValue: EditableGridCell) => {
            const sourceCol = visibleColumnIndexes[col]
            const column = view?.columns[sourceCol]?.name
            if (!column) return
            let text: string
            if (newValue.kind === GridCellKind.Text) text = newValue.data
            else if (newValue.kind === GridCellKind.Number) text = String(newValue.data)
            else if (newValue.kind === GridCellKind.Boolean) text = newValue.data ? 'true' : 'false'
            else return
            const colInfo = view?.info?.columns.find(c => c.name === column)
            const isNull = text === '' && !!colInfo?.nullable
            stageEdit(tab.id, shownIndex[row], column, text, isNull)
        },
        [view, tab.id, stageEdit, shownIndex, visibleColumnIndexes],
    )

    if (!view) return null

    const gridColumns: GridColumn[] = visibleColumnIndexes.map(index => view.columns[index]).map(c => {
        const sort = view.sorts.find(s => s.column === c.name)
        const arrow = sort ? (sort.desc ? ' ↓' : ' ↑') : ''
        const width = view.colWidths[c.name] ?? Math.min(Math.max(c.name.length * 9 + 30, 90), 280)
        return { id: c.name, title: c.name + arrow, width }
    })

    const dirty = view.edits.length > 0
    const range = selection?.current?.range
    const selCount = range ? range.width * range.height : 0
    const aggregation = selectionAggregation(range, shownRows, visibleColumnIndexes)

    // Pagination with a known total (from CountRows) enables last-page jump.
    const lastPage = view.total != null ? Math.max(0, Math.ceil(view.total / PAGE_SIZE) - 1) : null
    const rangeStart = view.rows.length === 0 ? 0 : view.page * PAGE_SIZE + 1
    const rangeEnd = view.page * PAGE_SIZE + view.rows.length

    const deleteSelected = () => {
        if (range) {
            stageDeleteBatch(tab.id, Array.from({ length: range.height }, (_, index) => shownIndex[range.y + index]))
        }
    }

    // Multiple edit: apply the typed value to every cell in the selection.
    const fillSelection = () => {
        if (!range) return
        const isBlank = fillValue === ''
        const changes: Array<{ rowIndex: number; column: string; text: string; isNull: boolean }> = []
        for (let c = range.x; c < range.x + range.width; c++) {
            const sourceCol = visibleColumnIndexes[c]
            const column = view.columns[sourceCol]?.name
            if (!column) continue
            const colInfo = view.info?.columns.find(ci => ci.name === column)
            const isNull = isBlank && !!colInfo?.nullable
            for (let r = range.y; r < range.y + range.height; r++) {
                changes.push({ rowIndex: shownIndex[r], column, text: fillValue, isNull })
            }
        }
        stageEditBatch(tab.id, changes)
    }

    // Re-fetch the current page from the database to pick up external changes.
    // Reloading discards local edits, so confirm first when any are pending.
    const refresh = () => {
        if (dirty) setConfirmRefresh(true)
        else reloadTable(tab.id, true)
    }

    const addFilter = () => {
        if (!fCol) return
        const next = [...view.filters, drivers.FilterSpec.createFrom({ column: fCol, op: fOp, value: fVal })]
        setTableFilters(tab.id, next)
        setFVal('')
    }
    const removeFilter = (i: number) => setTableFilters(tab.id, view.filters.filter((_, j) => j !== i))

    // Right-click menu for a grid cell.
    const cellMenuItems = (col: number, row: number): MenuItem[] => {
        const sourceCol = visibleColumnIndexes[col]
        const cell = shownRows[row]?.[sourceCol]
        const column = view.columns[sourceCol]?.name ?? ''
        const colInfo = view.info?.columns.find(c => c.name === column)
        const cellText = !cell || cell.t === 'null' ? '' : displayValue(cell)
        const foreignKey = view.info?.foreignKeys?.find(key => (key.columns ?? []).includes(column))
        const foreignKeyColumnIndex = foreignKey?.columns?.indexOf(column) ?? -1
        const referencedColumn = foreignKeyColumnIndex >= 0 ? foreignKey?.referencedColumns?.[foreignKeyColumnIndex] : undefined
        const rowCSV = () => toCSV(view.columns, [shownRows[row] ?? []])
        const typedEditor = !!cell && (isJsonColumn(colInfo?.typeName ?? '', cell.t) || !!temporalInputType(colInfo?.typeName ?? '', cell.t))
        const items: MenuItem[] = [
            { label: 'Copy value', onClick: () => Copy(cellText) },
            { label: 'Copy row (CSV)', onClick: () => Copy(rowCSV()) },
            {
                label: 'Filter by this value',
                disabled: !cell || cell.t === 'null',
                onClick: () => setTableFilters(tab.id, [
                    ...view.filters.filter(filter => filter.column !== column),
                    drivers.FilterSpec.createFrom({ column, op: '=', value: cellText }),
                ]),
            },
            {
                label: `Go to referenced row${foreignKey ? ` in ${foreignKey.referencedTable}` : ''}`,
                disabled: !foreignKey || !referencedColumn || !cell || cell.t === 'null',
                onClick: () => foreignKey && referencedColumn && openTableWithFilter(
                    tab.connId,
                    foreignKey.referencedSchema,
                    foreignKey.referencedTable,
                    referencedColumn,
                    cellText,
                ),
            },
            { label: 'Inspect value…', onClick: () => setInspect({ column, cell: cell ?? { t: 'null' } }) },
        ]
        if (editable) {
            items.push({ label: '', onClick: () => {}, separator: true })
            if (typedEditor) {
                items.push({
                    label: isJsonColumn(colInfo?.typeName ?? '', cell?.t ?? '') ? 'Edit JSON…' : 'Edit date/time…',
                    onClick: () => cell && setTypedEdit({
                        rowIndex: shownIndex[row],
                        column,
                        columnType: colInfo?.typeName ?? '',
                        cell,
                    }),
                })
            }
            items.push(
                {
                    label: 'Set NULL',
                    disabled: !colInfo?.nullable,
                    onClick: () => stageEdit(tab.id, shownIndex[row], column, '', true),
                },
                { label: 'Duplicate row', onClick: () => stageDuplicate(tab.id, shownIndex[row]) },
                { label: 'Delete row', danger: true, onClick: () => stageDelete(tab.id, shownIndex[row]) },
            )
        }
        return items
    }

    return (
        <div className={`table-tab ${detailSection !== 'data' ? 'details-open' : ''}`}>
            <div className="table-toolbar">
                <button
                    className={`ro-toggle ${readOnly ? 'locked' : ''}`}
                    onClick={() => setConnectionReadOnly(tab.connId, !readOnly)}
                    title={readOnly ? 'Read-only — click to allow edits' : 'Writable — click to lock (read-only)'}
                >
                    {readOnly ? '🔒 Read-only' : '🔓 Writable'}
                </button>
                <span className="tb-sep" />
                <button onClick={() => stageInsert(tab.id)} disabled={!editable} title="Add a new row">
                    + Row
                </button>
                <button onClick={deleteSelected} disabled={!editable || selCount === 0}>
                    Delete row
                </button>
                <button onClick={() => setShowImport(true)} disabled={!editable} title="Import CSV">
                    ⤒ Import
                </button>
                <button onClick={() => setShowGenerate(true)} disabled={readOnly || !view.info} title="Generate test data">
                    <DatabaseZap size={13} /> Generate
                </button>
                <button onClick={() => setShowTransfer(true)} disabled={!view.info || view.rows.length === 0} title="Transfer rows to another table">
                    <ArrowRightLeft size={13} /> Transfer
                </button>
                <button onClick={() => setShowSQLGenerator(true)} disabled={!view.info} title="Generate table SQL">
                    <Code2 size={13} /> SQL
                </button>
                <span className="tb-sep" />
                <div className="column-picker-wrap">
                    <button onClick={() => setColumnPickerOpen(open => !open)} title="Choose visible columns">
                        <Columns3 size={13} /> Columns
                    </button>
                    {columnPickerOpen && (
                        <div className="column-picker">
                            <div className="column-picker-header">
                                Visible columns
                                <button onClick={() => showAllColumns(tab.id)}>Show all</button>
                            </div>
                            {view.columns.map(column => (
                                <label key={column.name}>
                                    <input
                                        type="checkbox"
                                        checked={!view.hiddenColumns.includes(column.name)}
                                        disabled={!view.hiddenColumns.includes(column.name) && visibleColumnIndexes.length === 1}
                                        onChange={event => setColumnVisible(tab.id, column.name, event.target.checked)}
                                    />
                                    <span>{column.name}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
                <span className="tb-sep" />
                <button onClick={() => setTablePage(tab.id, 0)} disabled={view.page === 0 || view.loading} title="First page">
                    « First
                </button>
                <button onClick={() => setTablePage(tab.id, view.page - 1)} disabled={view.page === 0 || view.loading}>
                    ‹ Prev
                </button>
                <span className="tb-page">
                    {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()}
                    {view.total != null && ` of ${view.total.toLocaleString()}`}
                </span>
                <button onClick={() => setTablePage(tab.id, view.page + 1)} disabled={!view.hasMore || view.loading}>
                    Next ›
                </button>
                <button
                    onClick={() => lastPage != null && setTablePage(tab.id, lastPage)}
                    disabled={lastPage == null || view.page >= lastPage || view.loading}
                    title="Last page"
                >
                    Last »
                </button>
                <button onClick={refresh} disabled={view.loading} title="Reload this page from the database">
                    ⟳ Refresh
                </button>
                <span className="tb-sep" />
                <button onClick={() => setShowExport(true)} title="Export data">
                    ⇩ Export
                </button>
                <span className="tb-spacer" />
                {(view.undoStack.length > 0 || view.redoStack.length > 0) && <>
                    <button className="icon-btn" onClick={() => undoTableEdit(tab.id)} disabled={!view.undoStack.length} title="Undo table edit (Cmd/Ctrl+Z)"><Undo2 size={14} /></button>
                    <button className="icon-btn" onClick={() => redoTableEdit(tab.id)} disabled={!view.redoStack.length} title="Redo table edit (Cmd/Ctrl+Shift+Z)"><Redo2 size={14} /></button>
                </>}
                {dirty && (
                    <>
                        <button onClick={() => setShowChanges(true)} title="Inspect pending table changes"><ListChecks size={13} /> {view.edits.length} pending</button>
                        <button onClick={() => discardEdits(tab.id)}>Discard</button>
                        <button className="primary" onClick={() => applyEdits(tab.id)}>
                            Apply
                        </button>
                    </>
                )}
            </div>

            <div className="table-view-tabs" role="tablist" aria-label="Table details">
                {(['data', 'structure', 'keys', 'indexes', 'ddl', 'modify', 'compare', 'diagram', 'dependencies'] as const).map(section => (
                    <button
                        key={section}
                        role="tab"
                        aria-selected={detailSection === section}
                        className={detailSection === section ? 'active' : ''}
                        onClick={() => setDetailSection(section)}
                    >
                        {section === 'data' ? 'Data' : section[0].toUpperCase() + section.slice(1)}
                    </button>
                ))}
            </div>

            {detailSection !== 'data' && detailSection !== 'ddl' && detailSection !== 'modify' && detailSection !== 'compare' && detailSection !== 'diagram' && detailSection !== 'dependencies' && view.info && <TableDetails info={view.info} section={detailSection} />}
            {detailSection === 'ddl' && (
                <DdlSourceView connId={tab.connId} kind={tab.objectKind ?? 'table'} schema={tab.schema ?? ''} name={tab.table ?? ''} />
            )}
            {detailSection === 'modify' && view.info && (
                <SchemaMigrationEditor
                    connId={tab.connId}
                    engine={conn?.engine ?? 'postgres'}
                    info={view.info}
                    readOnly={readOnly}
                    onApplied={() => reloadTable(tab.id, true, true)}
                    onError={setError}
                />
            )}
            {detailSection === 'compare' && view.info && (
                <TableComparison
                    originConnId={tab.connId}
                    originEngine={conn?.engine ?? 'postgres'}
                    originInfo={view.info}
                    onError={setError}
                />
            )}
            {detailSection === 'diagram' && view.info && <ERDiagram connId={tab.connId} current={view.info} onError={setError} />}
            {detailSection === 'dependencies' && view.info && <DependencyAnalysis connId={tab.connId} current={view.info} onError={setError} />}

            <div className="table-filterbar">
                <span className="where-label">WHERE</span>
                <ColumnFilterInput
                    className="where-input"
                    placeholder="SQL filter, e.g. id > 100 AND created_at > '1999-01-01'"
                    value={whereDraft}
                    onChange={setWhereDraft}
                    onSubmit={() => setTableWhere(tab.id, whereDraft)}
                    columns={view.columns.map(c => c.name)}
                />
                <button onClick={() => setTableWhere(tab.id, whereDraft)}>Apply</button>
                {view.whereRaw && (
                    <button
                        onClick={() => {
                            setWhereDraft('')
                            setTableWhere(tab.id, '')
                        }}
                        title="Clear WHERE"
                    >
                        Clear
                    </button>
                )}
                <span className="tb-sep" />
                <input
                    className="grid-search"
                    placeholder="🔍 Search page…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <span className="tb-sep" />
                <select value={fCol} onChange={e => setFCol(e.target.value)}>
                    <option value="">filter column…</option>
                    {view.columns.map(c => (
                        <option key={c.name} value={c.name}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <select value={fOp} onChange={e => setFOp(e.target.value)}>
                    {FILTER_OPS.map(op => (
                        <option key={op} value={op}>
                            {op}
                        </option>
                    ))}
                </select>
                <input
                    className="filter-val"
                    placeholder="value"
                    value={fVal}
                    onChange={e => setFVal(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addFilter()}
                />
                <button onClick={addFilter} disabled={!fCol}>
                    Add filter
                </button>
                {view.filters.map((f, i) => (
                    <span key={i} className="filter-chip" onClick={() => removeFilter(i)} title="Remove filter">
                        {f.column} {f.op} {f.value} ×
                    </span>
                ))}
                {editable && selCount > 1 && (
                    <>
                        <span className="tb-spacer" />
                        <span className="tb-page">{selCount} cells</span>
                        <input
                            className="filter-val"
                            placeholder="set value"
                            value={fillValue}
                            onChange={e => setFillValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && fillSelection()}
                        />
                        <button onClick={fillSelection}>Set all</button>
                    </>
                )}
            </div>

            {readOnly && (
                <div className="table-banner">
                    This connection is read-only{conn?.envLabel === 'prod' ? ' (production)' : ''}. Click{' '}
                    <b>🔒 Read-only</b> in the toolbar to allow edits.
                </div>
            )}
            {view.info && !readOnly && !editable && (
                <div className="table-banner">
                    Read-only: this table has no primary or unique key, so edits can’t be targeted to a specific row.
                </div>
            )}
            {view.error && (
                <div className="table-error">
                    <span className="table-error-msg">{view.error}</span>
                    <CopyButton text={view.error} />
                    <button onClick={() => reloadTable(tab.id)}>Retry</button>
                </div>
            )}

            <div className="table-grid" ref={wrap}>
                {/* Only replace the grid with a spinner on the initial load. During a
                    refresh (columns already loaded) we keep the DataEditor mounted so
                    its scroll position survives, and dim it with an overlay instead. */}
                {view.loading && view.columns.length > 0 && <div className="grid-loading" />}
                {view.loading && view.columns.length === 0 ? (
                    <div className="grid-status">Loading…</div>
                ) : view.error && view.columns.length === 0 ? (
                    <div className="grid-status error">Couldn’t load this table.</div>
                ) : view.columns.length === 0 ? (
                    <div className="grid-status">No data.</div>
                ) : (
                    size.w > 0 && (
                        <DataEditor
                            width={size.w}
                            height={size.h}
                            columns={gridColumns}
                            rows={shownRows.length}
                            getCellContent={getCellContent}
                            onCellEdited={onCellEdited}
                            onHeaderClicked={colIdx => setTableSort(tab.id, view.columns[visibleColumnIndexes[colIdx]].name)}
                            onColumnResize={(col, newSize) => setColWidth(tab.id, col.id ?? '', newSize)}
                            onCellContextMenu={([col, row], e) => {
                                e.preventDefault()
                                const pointer = gridContextMenuCoordinates(e)
                                setMenu({
                                    x: pointer.x,
                                    y: pointer.y,
                                    col,
                                    row,
                                })
                            }}
                            gridSelection={selection}
                            onGridSelectionChange={setSelection}
                            rowMarkers="both"
                            rangeSelect="rect"
                            smoothScrollX
                            smoothScrollY
                        />
                    )
                )}
            </div>

            {aggregation && (
                <div className="table-aggregation">
                    <span>Count <strong>{aggregation.count.toLocaleString()}</strong></span>
                    {aggregation.numericCount > 0 && (
                        <>
                            <span>Sum <strong>{formatAggregate(aggregation.sum)}</strong></span>
                            <span>Average <strong>{formatAggregate(aggregation.sum / aggregation.numericCount)}</strong></span>
                            <span>Min <strong>{formatAggregate(aggregation.min)}</strong></span>
                            <span>Max <strong>{formatAggregate(aggregation.max)}</strong></span>
                        </>
                    )}
                </div>
            )}

            {dirty && view.previews.length > 0 && (
                <div className="sql-preview">
                    <div className="sql-preview-header">Pending SQL ({view.previews.length})</div>
                    <pre>{view.previews.map(p => p + ';').join('\n')}</pre>
                </div>
            )}

            {menu && <ContextMenu x={menu.x} y={menu.y} items={cellMenuItems(menu.col, menu.row)} onClose={() => setMenu(null)} />}
            {inspect && (
                <CellInspector connId={tab.connId} column={inspect.column} cell={inspect.cell} onClose={() => setInspect(null)} />
            )}
            {typedEdit && (
                <TypedCellEditor
                    connId={tab.connId}
                    column={typedEdit.column}
                    columnType={typedEdit.columnType}
                    cell={typedEdit.cell}
                    onCancel={() => setTypedEdit(null)}
                    onSave={value => {
                        stageEdit(tab.id, typedEdit.rowIndex, typedEdit.column, value, false)
                        setTypedEdit(null)
                    }}
                />
            )}
            {showImport && <ImportDialog tab={tab} onClose={() => setShowImport(false)} />}
            {showExport && (
                <ExportDialog
                    tab={tab}
                    view={view}
                    visibleColumnIndexes={visibleColumnIndexes}
                    shownRows={shownRows}
                    selection={range}
                    onClose={() => setShowExport(false)}
                    onError={setError}
                    engine={conn?.engine ?? 'postgres'}
                />
            )}
            {showGenerate && <TestDataDialog tab={tab} onClose={() => setShowGenerate(false)} />}
            {showTransfer && <DataTransferDialog tab={tab} onClose={() => setShowTransfer(false)} />}
            {showSQLGenerator && view.info && <SQLGeneratorDialog connId={tab.connId} engine={conn?.engine ?? 'postgres'} info={view.info} onClose={() => setShowSQLGenerator(false)} />}
            {showChanges && <TableChangesDialog view={view} onClose={() => setShowChanges(false)} onRevert={(editIndex, column) => revertTableEdit(tab.id, editIndex, column)} />}

            {view.conflicts.length > 0 && (
                <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && dismissEditConflicts(tab.id)}>
                    <div className="modal modal-warn edit-conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="edit-conflict-title">
                        <h2 id="edit-conflict-title"><TriangleAlert size={18} /> Row changed in the database</h2>
                        <p>
                            The changeset was rolled back because {view.conflicts.length === 1 ? 'a target row no longer matches' : 'some target rows no longer match'} the values loaded into this grid.
                            Your pending edits are still intact.
                        </p>
                        <div className="edit-conflict-list">
                            {view.conflicts.map(conflict => (
                                <div key={`${conflict.changeIndex}-${conflict.kind}`}>
                                    <b>{conflict.kind}</b>
                                    <code>{Object.entries(conflict.key ?? {}).map(([column, value]) => `${column}=${value.null ? 'NULL' : value.text}`).join(', ')}</code>
                                    <span>{conflict.reason}</span>
                                </div>
                            ))}
                        </div>
                        <p className="muted">Reload discards all pending edits. Overwrite retries against the current row using only its primary key.</p>
                        <div className="modal-buttons">
                            <button onClick={() => dismissEditConflicts(tab.id)}>Keep editing</button>
                            <div className="spacer" />
                            <button
                                className="danger"
                                onClick={() => {
                                    dismissEditConflicts(tab.id)
                                    reloadTable(tab.id, true)
                                }}
                            >
                                Reload and discard
                            </button>
                            <button
                                className="primary"
                                onClick={() => {
                                    dismissEditConflicts(tab.id)
                                    applyEdits(tab.id, true)
                                }}
                            >
                                Overwrite anyway
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmRefresh && (
                <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setConfirmRefresh(false)}>
                    <div className="modal modal-warn">
                        <h2>⚠ Discard pending edits?</h2>
                        <p>
                            Reloading from the database will discard your{' '}
                            <b>{view.edits.length}</b> pending {view.edits.length === 1 ? 'edit' : 'edits'}.
                        </p>
                        <div className="modal-buttons">
                            <div className="spacer" />
                            <button onClick={() => setConfirmRefresh(false)}>Cancel</button>
                            <button
                                className="danger"
                                onClick={() => {
                                    setConfirmRefresh(false)
                                    reloadTable(tab.id, true)
                                }}
                            >
                                Discard and reload
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export function selectionAggregation(
    range: { x: number; y: number; width: number; height: number } | undefined,
    rows: Value[][],
    visibleColumnIndexes: number[],
) {
    if (!range) return null
    let count = 0
    const numbers: number[] = []
    for (let row = range.y; row < range.y + range.height; row++) {
        for (let col = range.x; col < range.x + range.width; col++) {
            const cell = rows[row]?.[visibleColumnIndexes[col]]
            if (!cell || cell.t === 'null') continue
            count++
            if (cell.t === 'i64' || cell.t === 'f64') {
                const value = Number(cell.v)
                if (Number.isFinite(value)) numbers.push(value)
            }
        }
    }
    if (count === 0) return null
    return {
        count,
        numericCount: numbers.length,
        sum: numbers.reduce((sum, value) => sum + value, 0),
        min: numbers.length ? Math.min(...numbers) : 0,
        max: numbers.length ? Math.max(...numbers) : 0,
    }
}

function formatAggregate(value: number): string {
    return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 6 })
}
