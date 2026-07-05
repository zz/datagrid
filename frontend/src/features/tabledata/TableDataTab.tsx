import { useCallback, useEffect, useRef, useState } from 'react'
import {
    DataEditor,
    EditableGridCell,
    GridCell,
    GridCellKind,
    GridColumn,
    Item,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { useApp, PAGE_SIZE, Tab } from '../../store'
import type { Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'

export default function TableDataTab({ tab }: { tab: Tab }) {
    const view = useApp(s => s.tableViews[tab.id])
    const { setTableSort, setTablePage, stageEdit, stageInsert, stageDelete, discardEdits, applyEdits } = useApp()
    const wrap = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ w: 0, h: 0 })
    const [selectedRow, setSelectedRow] = useState<number | null>(null)

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

    const getCellContent = useCallback(
        ([col, row]: Item): GridCell => {
            const cell = view?.rows[row]?.[col]
            const editable = !!view?.info && view.info.primaryKey.length > 0
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
        [view],
    )

    const onCellEdited = useCallback(
        ([col, row]: Item, newValue: EditableGridCell) => {
            if (newValue.kind !== GridCellKind.Text) return
            const column = view?.columns[col]?.name
            if (!column) return
            const text = newValue.data
            // Empty string sets SQL NULL for nullable columns; otherwise text.
            const colInfo = view?.info?.columns.find(c => c.name === column)
            const isNull = text === '' && !!colInfo?.nullable
            stageEdit(tab.id, row, column, text, isNull)
        },
        [view, tab.id, stageEdit],
    )

    if (!view) return null

    const gridColumns: GridColumn[] = view.columns.map(c => {
        const sort = view.sorts.find(s => s.column === c.name)
        const arrow = sort ? (sort.desc ? ' ↓' : ' ↑') : ''
        return { id: c.name, title: c.name + arrow, width: Math.min(Math.max(c.name.length * 9 + 30, 90), 280) }
    })

    const editable = view.info && view.info.primaryKey.length > 0
    const dirty = view.edits.length > 0

    const deleteSelected = () => {
        if (selectedRow != null) stageDelete(tab.id, selectedRow)
    }

    return (
        <div className="table-tab">
            <div className="table-toolbar">
                <button onClick={() => stageInsert(tab.id)} disabled={!editable} title="Add a new row">
                    + Row
                </button>
                <button onClick={deleteSelected} disabled={!editable || selectedRow == null}>
                    Delete row
                </button>
                <span className="tb-sep" />
                <button onClick={() => setTablePage(tab.id, view.page - 1)} disabled={view.page === 0 || view.loading}>
                    ‹ Prev
                </button>
                <span className="tb-page">
                    rows {view.page * PAGE_SIZE + 1}–{view.page * PAGE_SIZE + view.rows.length}
                </span>
                <button onClick={() => setTablePage(tab.id, view.page + 1)} disabled={!view.hasMore || view.loading}>
                    Next ›
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

            {!editable && (
                <div className="table-banner">
                    Read-only: this table has no primary or unique key, so edits can’t be targeted to a specific row.
                </div>
            )}
            {view.error && <div className="table-error">{view.error}</div>}

            <div className="table-grid" ref={wrap}>
                {size.w > 0 && view.columns.length > 0 && (
                    <DataEditor
                        width={size.w}
                        height={size.h}
                        columns={gridColumns}
                        rows={view.rows.length}
                        getCellContent={getCellContent}
                        onCellEdited={onCellEdited}
                        onHeaderClicked={colIdx => setTableSort(tab.id, view.columns[colIdx].name)}
                        onGridSelectionChange={sel => setSelectedRow(sel.current?.cell[1] ?? null)}
                        rowMarkers="both"
                        smoothScrollX
                        smoothScrollY
                    />
                )}
            </div>

            {dirty && view.previews.length > 0 && (
                <div className="sql-preview">
                    <div className="sql-preview-header">Pending SQL ({view.previews.length})</div>
                    <pre>{view.previews.map(p => p + ';').join('\n')}</pre>
                </div>
            )}
        </div>
    )
}

// Re-export so the value-null helper stays colocated with its use.
export type { Value }
