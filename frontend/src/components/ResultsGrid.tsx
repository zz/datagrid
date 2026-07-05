import { useCallback, useEffect, useRef, useState } from 'react'
import {
    DataEditor,
    GridCell,
    GridCellKind,
    GridColumn,
    Item,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import type { Column, Value } from '../ipc/types'
import { displayValue } from '../ipc/types'
import CellInspector from './CellInspector'
import ContextMenu, { MenuItem } from './ContextMenu'
import { Copy } from '../../wailsjs/go/api/App'
import { toCSV } from '../export'

interface Props {
    connId: string
    columns: Column[]
    rows: Value[][]
}

export default function ResultsGrid({ connId, columns, rows }: Props) {
    const wrap = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ w: 0, h: 0 })
    const [inspect, setInspect] = useState<{ column: string; cell: Value } | null>(null)
    const [search, setSearch] = useState('')
    const [widths, setWidths] = useState<Record<string, number>>({})
    const [menu, setMenu] = useState<{ x: number; y: number; col: number; row: number } | null>(null)

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

    // Text search filters the loaded rows to those with a cell containing the
    // query (case-insensitive) — DataGrip-style find within the result set.
    const shownRows =
        search.trim() === ''
            ? rows
            : rows.filter(r =>
                  r.some(c => c && c.t !== 'null' && String(c.v ?? '').toLowerCase().includes(search.toLowerCase())),
              )

    const gridColumns: GridColumn[] = columns.map(c => ({
        id: c.name,
        title: c.name,
        width: widths[c.name] ?? Math.min(Math.max(c.name.length * 9 + 24, 90), 260),
    }))

    const cellMenuItems = (col: number, row: number): MenuItem[] => {
        const cell = shownRows[row]?.[col]
        const column = columns[col]?.name ?? ''
        const text = !cell || cell.t === 'null' ? '' : displayValue(cell)
        return [
            { label: 'Copy value', onClick: () => Copy(text) },
            { label: 'Copy row (CSV)', onClick: () => Copy(toCSV(columns, [shownRows[row] ?? []])) },
            { label: 'Inspect value…', onClick: () => setInspect({ column, cell: cell ?? { t: 'null' } }) },
        ]
    }

    const getCellContent = useCallback(
        ([col, row]: Item): GridCell => {
            const cell = shownRows[row]?.[col]
            if (!cell) {
                return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false }
            }
            const text = displayValue(cell)
            if (cell.t === 'i64' || cell.t === 'f64') {
                return {
                    kind: GridCellKind.Number,
                    data: typeof cell.v === 'number' ? cell.v : undefined,
                    displayData: text,
                    allowOverlay: true,
                    readonly: true,
                }
            }
            return {
                kind: GridCellKind.Text,
                data: text,
                displayData: cell.t === 'null' ? 'NULL' : text.slice(0, 512),
                allowOverlay: true,
                readonly: true,
                themeOverride: cell.t === 'null' ? { textDark: '#8a8a90' } : undefined,
            }
        },
        [shownRows],
    )

    // Double-clicking a cell opens the inspector — the only way to read a
    // truncated oversized value in full.
    const onCellActivated = useCallback(
        ([col, row]: Item) => {
            const cell = shownRows[row]?.[col]
            if (cell) setInspect({ column: columns[col]?.name ?? '', cell })
        },
        [shownRows, columns],
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
            </div>
            <div className="results-grid" ref={wrap}>
                {size.w > 0 && columns.length > 0 && (
                    <DataEditor
                        width={size.w}
                        height={size.h}
                        columns={gridColumns}
                        rows={shownRows.length}
                        getCellContent={getCellContent}
                        onCellActivated={onCellActivated}
                        onColumnResize={(col, newSize) => setWidths(w => ({ ...w, [col.id ?? '']: newSize }))}
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
            {menu && (
                <ContextMenu x={menu.x} y={menu.y} items={cellMenuItems(menu.col, menu.row)} onClose={() => setMenu(null)} />
            )}
            {inspect && (
                <CellInspector
                    connId={connId}
                    column={inspect.column}
                    cell={inspect.cell}
                    onClose={() => setInspect(null)}
                />
            )}
        </div>
    )
}

// results-grid-wrap wraps the search bar + grid; keep the grid filling the rest.
