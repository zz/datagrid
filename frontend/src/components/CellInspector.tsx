import { useEffect, useState } from 'react'
import { FetchCell } from '../../wailsjs/go/api/App'
import type { Value } from '../ipc/types'
import { displayValue } from '../ipc/types'

interface Props {
    connId: string
    column: string
    cell: Value
    onClose: () => void
}

// CellInspector shows a cell's full value. Oversized cells cross IPC
// truncated with a `ref`; the full value is fetched on demand (design §4).
export default function CellInspector({ connId, column, cell, onClose }: Props) {
    const [full, setFull] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!cell.ref) return
        setLoading(true)
        FetchCell(connId, cell.ref)
            .then(v => setFull(String(v.v ?? '')))
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false))
    }, [connId, cell.ref])

    const text = cell.ref ? (full ?? '') : cell.t === 'null' ? 'NULL' : displayValue(cell)

    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal cell-inspector">
                <div className="cell-inspector-header">
                    <span className="cell-inspector-col">{column}</span>
                    <span className="cell-inspector-type">{cell.t}</span>
                    {cell.ref && <span className="cell-inspector-full">full value</span>}
                    <button className="icon-btn" onClick={onClose} title="Close">
                        ×
                    </button>
                </div>
                {loading && <div className="cell-inspector-status">Loading full value…</div>}
                {error && <div className="cell-inspector-status error">{error}</div>}
                <pre className="cell-inspector-body">{text}</pre>
                <div className="cell-inspector-footer">{text.length.toLocaleString()} chars</div>
            </div>
        </div>
    )
}
