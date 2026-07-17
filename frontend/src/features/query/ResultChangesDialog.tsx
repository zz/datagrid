import { Code2, ListChecks, RotateCcw, X } from 'lucide-react'
import type { Column, Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'
import type { EditableResultChange } from './editableResults'

function rowLabel(change: EditableResultChange) {
    if (change.kind === 'insert') return `new row ${change.rowIndex + 1}`
    return Object.entries(change.key).map(([name, value]) => `${name}=${value.null ? 'NULL' : value.text}`).join(', ')
}

function beforeValue(columns: Column[], baseRows: Value[][], change: EditableResultChange, column: string) {
    if (change.kind === 'insert') return 'DEFAULT'
    const index = columns.findIndex(item => item.name === column)
    return displayValue(baseRows[change.rowIndex]?.[index] ?? { t: 'null' })
}

export default function ResultChangesDialog({ columns, baseRows, changes, previews, previewLoading, previewError, onClose, onRevert }: {
    columns: Column[]
    baseRows: Value[][]
    changes: EditableResultChange[]
    previews: string[]
    previewLoading: boolean
    previewError: string
    onClose: () => void
    onRevert: (change: EditableResultChange, column?: string) => void
}) {
    const counts = changes.reduce((result, change) => ({ ...result, [change.kind]: result[change.kind] + 1 }), { insert: 0, update: 0, delete: 0 })
    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
        <div className="modal table-changes-dialog result-changes-dialog">
            <div className="table-changes-title"><div><h2>Pending Result Changes</h2><span>{counts.insert} inserts, {counts.update} updates, {counts.delete} deletes</span></div><button className="icon-btn" onClick={onClose} title="Close"><X size={15} /></button></div>
            <div className="result-changes-body">
                <section>
                    <div className="result-changes-section-title"><ListChecks size={13} /> Changes</div>
                    <div className="table-changes-list">
                        <div className="table-change-row heading"><span>Operation</span><span>Row</span><span>Column</span><span>Before</span><span>After</span><span /></div>
                        {changes.flatMap(change => {
                            const fields = Object.entries(change.set)
                            if (change.kind === 'delete' || fields.length === 0) return [<div className="table-change-row" key={`${change.kind}:${change.rowIndex}`}><span className={`table-change-kind ${change.kind}`}>{change.kind}</span><code>{rowLabel(change)}</code><span>All fields</span><span>{change.kind === 'delete' ? 'Existing row' : 'Database defaults'}</span><span>{change.kind === 'delete' ? 'Deleted' : 'New row'}</span><button className="icon-btn" onClick={() => onRevert(change)} title="Revert change"><RotateCcw size={12} /></button></div>]
                            return fields.map(([column, value], fieldIndex) => <div className="table-change-row" key={`${change.kind}:${change.rowIndex}:${column}`}><span className={`table-change-kind ${change.kind}`}>{fieldIndex === 0 ? change.kind : ''}</span><code>{rowLabel(change)}</code><strong>{column}</strong><code>{beforeValue(columns, baseRows, change, column)}</code><code className={value.null ? 'null' : ''}>{value.null ? 'NULL' : value.text}</code><button className="icon-btn" onClick={() => onRevert(change, column)} title="Revert field change"><RotateCcw size={12} /></button></div>)
                        })}
                        {!changes.length && <div className="table-changes-empty">No pending changes.</div>}
                    </div>
                </section>
                <section className="result-change-preview">
                    <div className="result-changes-section-title"><Code2 size={13} /> Generated SQL</div>
                    <div>{previewLoading ? <span className="result-change-preview-state">Generating preview...</span> : previewError ? <span className="result-change-preview-state error">{previewError}</span> : previews.length ? previews.map((sql, index) => <pre key={index}>{sql};</pre>) : <span className="result-change-preview-state">No SQL to execute.</span>}</div>
                </section>
            </div>
            <div className="modal-buttons"><span>Generated SQL includes optimistic original-value checks.</span><div className="spacer" /><button onClick={onClose}>Close</button></div>
        </div>
    </div>
}
