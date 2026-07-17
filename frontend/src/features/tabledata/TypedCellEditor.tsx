import { useEffect, useState } from 'react'
import { FetchCell } from '../../../wailsjs/go/api/App'
import type { Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'
import { formatJson, isBooleanColumn, isJsonColumn, normalizeTypedValue, temporalInputType, toTemporalInput } from './typedValues'

export default function TypedCellEditor({
    connId,
    column,
    columnType,
    cell,
    onCancel,
    onSave,
}: {
    connId: string
    column: string
    columnType: string
    cell: Value
    onCancel: () => void
    onSave: (value: string) => void
}) {
    const json = isJsonColumn(columnType, cell.t)
    const boolean = isBooleanColumn(columnType, cell.t)
    const temporal = temporalInputType(columnType, cell.t)
    const initial = cell.t === 'null' ? '' : displayValue(cell)
    const [value, setValue] = useState(() => json ? safeFormat(initial) : temporal ? toTemporalInput(initial, temporal) : boolean ? (initial.toLowerCase() === 'true' || initial === '1' ? 'true' : 'false') : initial)
    const [loading, setLoading] = useState(!!cell.ref)
    const [error, setError] = useState('')

    useEffect(() => {
        if (!cell.ref) return
        FetchCell(connId, cell.ref)
            .then(full => {
                const raw = String(full.v ?? '')
                setValue(json ? safeFormat(raw) : temporal ? toTemporalInput(raw, temporal) : raw)
            })
            .catch(err => setError(String(err)))
            .finally(() => setLoading(false))
    }, [cell.ref, connId, json, temporal])

    const save = () => {
        const normalized = normalizeTypedValue(columnType, cell.t, value)
        if (normalized.error) { setError(normalized.error); return }
        onSave(normalized.value)
    }

    return (
        <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
            <div className="modal typed-cell-editor">
                <h2>Edit {column}</h2>
                <div className="typed-cell-meta">{columnType}</div>
                {json ? (
                    <textarea value={value} onChange={event => setValue(event.target.value)} autoFocus spellCheck={false} />
                ) : boolean ? (
                    <label className="typed-boolean-input"><input type="checkbox" checked={value === 'true'} onChange={event => setValue(event.target.checked ? 'true' : 'false')} autoFocus /><span>{value === 'true' ? 'True' : 'False'}</span></label>
                ) : (
                    <input type={temporal ?? 'text'} value={value} onChange={event => setValue(event.target.value)} autoFocus />
                )}
                {loading && <div className="dialog-status busy">Loading full value…</div>}
                {error && <div className="dialog-status err">{error}</div>}
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onCancel}>Cancel</button>
                    <button className="primary" disabled={loading} onClick={save}>Stage Change</button>
                </div>
            </div>
        </div>
    )
}

function safeFormat(value: string): string {
    try { return formatJson(value) } catch { return value }
}
