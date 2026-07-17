import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { ApplyMigration } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import ConfirmDialog from '../../components/ConfirmDialog'
import { ColumnDraft, generateColumnMigration } from './migration'

const draftsFrom = (info: drivers.TableInfo): ColumnDraft[] => info.columns.map(column => ({
    originalName: column.name,
    name: column.name,
    typeName: column.typeName,
    nullable: column.nullable,
    default: column.default,
}))

export default function SchemaMigrationEditor({
    connId, engine, info, readOnly, onApplied, onError,
}: {
    connId: string
    engine: string
    info: drivers.TableInfo
    readOnly: boolean
    onApplied: () => Promise<void>
    onError: (message: string) => void
}) {
    const [drafts, setDrafts] = useState(() => draftsFrom(info))
    const generated = useMemo(() => generateColumnMigration(engine, info.schema, info.table, info.columns, drafts), [drafts, engine, info])
    const [sql, setSQL] = useState(generated)
    const [busy, setBusy] = useState(false)
    const [confirm, setConfirm] = useState(false)
    useEffect(() => setDrafts(draftsFrom(info)), [info])
    useEffect(() => setSQL(generated), [generated])

    const update = (index: number, patch: Partial<ColumnDraft>) => setDrafts(current => current.map((draft, i) => i === index ? { ...draft, ...patch } : draft))
    const destructive = info.columns.some(column => !drafts.some(draft => draft.originalName === column.name)) || drafts.some(draft => {
        const original = info.columns.find(column => column.name === draft.originalName)
        return !!original && original.typeName !== draft.typeName
    })

    const apply = async () => {
        setBusy(true)
        try {
            await ApplyMigration(connId, sql)
            await onApplied()
        } catch (error) { onError(String(error)) } finally { setBusy(false); setConfirm(false) }
    }

    return (
        <div className="schema-migration-editor">
            {engine === 'mysql' && <div className="migration-warning"><AlertTriangle size={14} /> MySQL/MariaDB may implicitly commit DDL; partial migrations cannot always be rolled back.</div>}
            <div className="migration-columns">
                <div className="migration-heading">Column Draft <span>{drafts.length}</span><div className="tb-spacer" />
                    <button onClick={() => setDrafts(current => [...current, { name: 'new_column', typeName: 'varchar(255)', nullable: true, default: '' }])} disabled={readOnly}><Plus size={13} /> Add</button>
                    <button onClick={() => setDrafts(draftsFrom(info))}><RotateCcw size={13} /> Reset</button>
                </div>
                <div className="migration-column-list">
                    {drafts.map((draft, index) => <div className="migration-column" key={draft.originalName ?? `new-${index}`}>
                        <input value={draft.name} onChange={event => update(index, { name: event.target.value })} disabled={readOnly} aria-label="Column name" />
                        <input value={draft.typeName} onChange={event => update(index, { typeName: event.target.value })} disabled={readOnly} aria-label="Column type" />
                        <input value={draft.default} onChange={event => update(index, { default: event.target.value })} disabled={readOnly} placeholder="default" aria-label="Column default" />
                        <label><input type="checkbox" checked={draft.nullable} onChange={event => update(index, { nullable: event.target.checked })} disabled={readOnly} /> Null</label>
                        <button className="icon-btn" onClick={() => setDrafts(current => current.filter((_, i) => i !== index))} disabled={readOnly} title="Drop column"><Trash2 size={13} /></button>
                    </div>)}
                </div>
            </div>
            <div className="migration-preview">
                <div className="migration-heading">Migration SQL <span>{sql ? `${sql.split(';').filter(Boolean).length} statements` : 'No changes'}</span></div>
                <textarea value={sql} onChange={event => setSQL(event.target.value)} spellCheck={false} readOnly={readOnly} />
                <div className="migration-actions"><span>{engine === 'postgres' ? 'Applies in one transaction.' : 'Review every statement before applying.'}</span><div className="tb-spacer" />
                    <button className="primary" disabled={readOnly || busy || !sql.trim()} onClick={() => setConfirm(true)}>Apply Migration</button>
                </div>
            </div>
            {confirm && <ConfirmDialog title="Apply schema migration?" message={destructive ? 'This migration includes destructive column changes. Review the SQL carefully before applying.' : 'Apply the generated migration to this table?'} confirmLabel="Apply Migration" danger={destructive} onCancel={() => setConfirm(false)} onConfirm={apply} />}
        </div>
    )
}
