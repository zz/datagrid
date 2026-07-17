import { useMemo, useState } from 'react'
import { Code2, Plus } from 'lucide-react'
import { CreateObjectSource } from '../../../wailsjs/go/api/App'
import SqlEditor from '../../components/SqlEditor'
import ConfirmDialog from '../../components/ConfirmDialog'
import { CreatableObjectKind, objectTemplate } from './objectTemplates'

export default function CreateObjectSourceDialog({ connId, engine, schema, initialKind, readOnly, onClose, onCreated, onError }: {
    connId: string
    engine: string
    schema: string
    initialKind: CreatableObjectKind
    readOnly: boolean
    onClose: () => void
    onCreated: (kind: CreatableObjectKind) => void
    onError: (error: string) => void
}) {
    const [kind, setKind] = useState(initialKind)
    const [name, setName] = useState(`new_${initialKind}`)
    const [source, setSource] = useState(() => objectTemplate(engine, initialKind, schema, `new_${initialKind}`))
    const [busy, setBusy] = useState(false)
    const [confirm, setConfirm] = useState(false)
    const expected = useMemo(() => objectTemplate(engine, kind, schema, name.trim() || `new_${kind}`), [engine, kind, name, schema])
    const changeKind = (next: CreatableObjectKind) => { setKind(next); setName(`new_${next}`); setSource(objectTemplate(engine, next, schema, `new_${next}`)) }
    const updateName = (next: string) => { const previous = expected; setName(next); if (source === previous) setSource(objectTemplate(engine, kind, schema, next.trim() || `new_${kind}`)) }
    const create = async () => {
        setConfirm(false); setBusy(true)
        try { await CreateObjectSource(connId, kind, source); onCreated(kind); onClose() }
        catch (error) { onError(String(error)) } finally { setBusy(false) }
    }
    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
        <div className="modal create-object-source-dialog">
            <div className="object-source-title"><Plus size={17} /><div><h2>Create Database Object</h2><span>{schema}</span></div></div>
            <div className="create-object-controls"><label>Object type<select value={kind} onChange={event => changeKind(event.target.value as CreatableObjectKind)}><option value="view">View</option><option value="routine">Routine</option><option value="trigger">Trigger</option></select></label><label>Name<input value={name} onChange={event => updateName(event.target.value)} /></label><span><Code2 size={12} /> Edit the executable definition before creating.</span></div>
            <div className="object-source-editor"><SqlEditor engine={engine} value={source} onChange={setSource} onRun={() => setConfirm(true)} onFormatError={onError} /></div>
            {engine === 'mysql' && kind !== 'view' && <div className="migration-warning">The routine or trigger body is submitted directly; do not include client-only DELIMITER commands.</div>}
            {readOnly && <div className="migration-warning">Object creation is disabled because this connection is read-only.</div>}
            <div className="modal-buttons"><span>{engine === 'postgres' ? 'PostgreSQL creation runs transactionally.' : 'MySQL object DDL may commit implicitly.'}</span><div className="spacer" /><button onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={readOnly || busy || !name.trim() || !source.trim()} onClick={() => setConfirm(true)}><Plus size={12} /> Create {kind}</button></div>
        </div>
        {confirm && <ConfirmDialog title={`Create ${kind} “${name}”?`} message="The edited SQL definition will be executed against the selected database." confirmLabel={`Create ${kind}`} onCancel={() => setConfirm(false)} onConfirm={() => void create()} />}
    </div>
}
