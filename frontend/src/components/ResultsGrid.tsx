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

interface Props {
    columns: Column[]
    rows: Value[][]
}

export default function ResultsGrid({ columns, rows }: Props) {
    const wrap = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ w: 0, h: 0 })

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

    const gridColumns: GridColumn[] = columns.map(c => ({
        id: c.name,
        title: c.name,
        width: Math.min(Math.max(c.name.length * 9 + 24, 90), 260),
    }))

    const getCellContent = useCallback(
        ([col, row]: Item): GridCell => {
            const cell = rows[row]?.[col]
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
        [rows],
    )

    return (
        <div className="results-grid" ref={wrap}>
            {size.w > 0 && columns.length > 0 && (
                <DataEditor
                    width={size.w}
                    height={size.h}
                    columns={gridColumns}
                    rows={rows.length}
                    getCellContent={getCellContent}
                    rowMarkers="number"
                    smoothScrollX
                    smoothScrollY
                    getCellsForSelection={true}
                />
            )}
        </div>
    )
}
