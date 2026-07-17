import { RotateCcw, X } from 'lucide-react'
import type { PendingEdit, TableView } from '../../store'
import { displayValue } from '../../ipc/types'

function editLabel(edit: PendingEdit) {
    if (edit.kind === 'insert') return 'Insert'
    if (edit.kind === 'delete') return 'Delete'
    return 'Update'
}

function originalValue(view: TableView, edit: PendingEdit, column: string) {
    if (edit.kind === 'insert') return 'NULL'
    const index = view.columns.findIndex(item => item.name === column)
    return index < 0 ? '' : displayValue(view.baseRows[edit.rowIndex]?.[index] ?? { t: 'null' })
}

export default function TableChangesDialog({ view, onClose, onRevert }: {
    view: TableView
    onClose: () => void
    onRevert: (editIndex: number, column?: string) => void
}) {
    const counts = view.edits.reduce((result, edit) => ({ ...result, [edit.kind]: result[edit.kind] + 1 }), { insert: 0, update: 0, delete: 0 })
    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
        <div className="modal table-changes-dialog">
            <div className="table-changes-title"><div><h2>Pending Table Changes</h2><span>{counts.insert} inserts, {counts.update} updates, {counts.delete} deletes</span></div><button className="icon-btn" onClick={onClose} title="Close"><X size={15} /></button></div>
            <div className="table-changes-list">
                <div className="table-change-row heading"><span>Operation</span><span>Row</span><span>Column</span><span>Before</span><span>After</span><span /></div>
                {view.edits.flatMap((edit, editIndex) => {
                    const fields = Object.entries(edit.set)
                    if (edit.kind === 'delete' || fields.length === 0) return [<div className="table-change-row" key={`${editIndex}:row`}><span className={`table-change-kind ${edit.kind}`}>{editLabel(edit)}</span><code>{edit.kind === 'insert' ? `new row ${edit.rowIndex + 1}` : Object.entries(edit.key).map(([key, value]) => `${key}=${value}`).join(', ')}</code><span>All fields</span><span>{edit.kind === 'delete' ? 'Existing row' : 'NULL values'}</span><span>{edit.kind === 'delete' ? 'Deleted' : 'New row'}</span><button className="icon-btn" onClick={() => onRevert(editIndex)} title="Revert change"><RotateCcw size={12} /></button></div>]
                    return fields.map(([column, value], fieldIndex) => <div className="table-change-row" key={`${editIndex}:${column}`}><span className={`table-change-kind ${edit.kind}`}>{fieldIndex === 0 ? editLabel(edit) : ''}</span><code>{edit.kind === 'insert' ? `new row ${edit.rowIndex + 1}` : Object.entries(edit.key).map(([key, keyValue]) => `${key}=${keyValue}`).join(', ')}</code><strong>{column}</strong><code>{originalValue(view, edit, column)}</code><code className={value.null ? 'null' : ''}>{value.null ? 'NULL' : value.text}</code><button className="icon-btn" onClick={() => onRevert(editIndex, column)} title="Revert field change"><RotateCcw size={12} /></button></div>)
                })}
                {!view.edits.length && <div className="table-changes-empty">No pending changes.</div>}
            </div>
            <div className="modal-buttons"><span>Changes are local until Apply is selected.</span><div className="spacer" /><button onClick={onClose}>Close</button></div>
        </div>
    </div>
}
