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
import { exportRows, ExportFormat, toCSV } from '../../export'
import ImportDialog from './ImportDialog'
import CopyButton from '../../components/CopyButton'
import ContextMenu, { MenuItem } from '../../components/ContextMenu'
import CellInspector from '../../components/CellInspector'

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
        stageEdit,
        stageInsert,
        stageDelete,
        discardEdits,
        applyEdits,
        reloadTable,
        setError,
    } = useApp()
    const wrap = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ w: 0, h: 0 })
    const [selection, setSelection] = useState<GridSelection | undefined>(undefined)
    const [search, setSearch] = useState('')
    const [fillValue, setFillValue] = useState('')
    const [showImport, setShowImport] = useState(false)
    const [confirmRefresh, setConfirmRefresh] = useState(false)
    const [whereDraft, setWhereDraft] = useState('')
    const [menu, setMenu] = useState<{ x: number; y: number; col: number; row: number } | null>(null)
    const [inspect, setInspect] = useState<{ column: string; cell: Value } | null>(null)
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

    const readOnly = !!conn?.readOnly
    // A read-only connection blocks all edits; a missing PK/unique key means we
    // can't target a row. Editing needs both a key and a writable connection.
    const editable = !!view?.info && view.info.primaryKey.length > 0 && !readOnly

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
            const cell = shownRows[row]?.[col]
            if (!cell) {
                return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: editable }
            }
            const text = cell.t === 'null' ? '' : displayValue(cell)
            return {
                kind: GridCellKind.Text,
                data: text,
                displayData: cell.t === 'null' ? 'NULL' : text.slice(0, 512),
                allowOverlay: editable,
                readonly: !editable,
                themeOverride: cell.t === 'null' ? { textDark: '#8a8a90' } : undefined,
            }
        },
        [shownRows, editable],
    )

    const onCellEdited = useCallback(
        ([col, row]: Item, newValue: EditableGridCell) => {
            if (newValue.kind !== GridCellKind.Text) return
            const column = view?.columns[col]?.name
            if (!column) return
            const text = newValue.data
            const colInfo = view?.info?.columns.find(c => c.name === column)
            const isNull = text === '' && !!colInfo?.nullable
            stageEdit(tab.id, shownIndex[row], column, text, isNull)
        },
        [view, tab.id, stageEdit, shownIndex],
    )

    if (!view) return null

    const gridColumns: GridColumn[] = view.columns.map(c => {
        const sort = view.sorts.find(s => s.column === c.name)
        const arrow = sort ? (sort.desc ? ' ↓' : ' ↑') : ''
        const width = view.colWidths[c.name] ?? Math.min(Math.max(c.name.length * 9 + 30, 90), 280)
        return { id: c.name, title: c.name + arrow, width }
    })

    const dirty = view.edits.length > 0
    const range = selection?.current?.range
    const selCount = range ? range.width * range.height : 0

    // Pagination with a known total (from CountRows) enables last-page jump.
    const lastPage = view.total != null ? Math.max(0, Math.ceil(view.total / PAGE_SIZE) - 1) : null
    const rangeStart = view.rows.length === 0 ? 0 : view.page * PAGE_SIZE + 1
    const rangeEnd = view.page * PAGE_SIZE + view.rows.length

    const deleteSelected = () => {
        if (range) {
            for (let r = range.y; r < range.y + range.height; r++) stageDelete(tab.id, shownIndex[r])
        }
    }

    // Multiple edit: apply the typed value to every cell in the selection.
    const fillSelection = () => {
        if (!range) return
        const isBlank = fillValue === ''
        for (let c = range.x; c < range.x + range.width; c++) {
            const column = view.columns[c]?.name
            if (!column) continue
            const colInfo = view.info?.columns.find(ci => ci.name === column)
            const isNull = isBlank && !!colInfo?.nullable
            for (let r = range.y; r < range.y + range.height; r++) {
                stageEdit(tab.id, shownIndex[r], column, fillValue, isNull)
            }
        }
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

    const doExport = async (fmt: ExportFormat) => {
        try {
            await exportRows(`${tab.table}`, fmt, view.columns, view.rows)
        } catch (err) {
            setError(String(err))
        }
    }

    // Right-click menu for a grid cell.
    const cellMenuItems = (col: number, row: number): MenuItem[] => {
        const cell = shownRows[row]?.[col]
        const column = view.columns[col]?.name ?? ''
        const colInfo = view.info?.columns.find(c => c.name === column)
        const cellText = !cell || cell.t === 'null' ? '' : displayValue(cell)
        const rowCSV = () => toCSV(view.columns, [shownRows[row] ?? []])
        const items: MenuItem[] = [
            { label: 'Copy value', onClick: () => Copy(cellText) },
            { label: 'Copy row (CSV)', onClick: () => Copy(rowCSV()) },
            { label: 'Inspect value…', onClick: () => setInspect({ column, cell: cell ?? { t: 'null' } }) },
        ]
        if (editable) {
            items.push(
                { label: '', onClick: () => {}, separator: true },
                {
                    label: 'Set NULL',
                    disabled: !colInfo?.nullable,
                    onClick: () => stageEdit(tab.id, shownIndex[row], column, '', true),
                },
                { label: 'Delete row', danger: true, onClick: () => stageDelete(tab.id, shownIndex[row]) },
            )
        }
        return items
    }

    return (
        <div className="table-tab">
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
                <button onClick={() => doExport('csv')} title="Export page as CSV">
                    ⇩ CSV
                </button>
                <button onClick={() => doExport('json')} title="Export page as JSON">
                    ⇩ JSON
                </button>
                <span className="tb-spacer" />
                {dirty && (
                    <>
                        <span className="tb-dirty">{view.edits.length} pending</span>
                        <button onClick={() => discardEdits(tab.id)}>Discard</button>
                        <button className="primary" onClick={() => applyEdits(tab.id)}>
                            Apply
                        </button>
                    </>
                )}
            </div>

            <div className="table-filterbar">
                <span className="where-label">WHERE</span>
                <input
                    className="where-input"
                    placeholder="SQL filter, e.g. id > 100 AND created_at > '1999-01-01'"
                    value={whereDraft}
                    onChange={e => setWhereDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && setTableWhere(tab.id, whereDraft)}
                    spellCheck={false}
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
                            onHeaderClicked={colIdx => setTableSort(tab.id, view.columns[colIdx].name)}
                            onColumnResize={(col, newSize) => setColWidth(tab.id, col.id ?? '', newSize)}
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
            {showImport && <ImportDialog tab={tab} onClose={() => setShowImport(false)} />}

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
