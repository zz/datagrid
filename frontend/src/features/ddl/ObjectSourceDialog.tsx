import { useCallback, useEffect, useMemo, useState } from 'react'
import { Code2, Columns2, RefreshCw, Save } from 'lucide-react'
import { ApplyObjectSource, GetObjectDDL } from '../../../wailsjs/go/api/App'
import SqlEditor from '../../components/SqlEditor'
import ConfirmDialog from '../../components/ConfirmDialog'
import { sourceChangeSummary } from './objectSource'

export default function ObjectSourceDialog({ connId, engine, kind, schema, name, readOnly, onClose, onError }: {
    connId: string
    engine: string
    kind: 'view' | 'routine' | 'trigger' | 'sequence'
    schema: string
    name: string
    readOnly: boolean
    onClose: () => void
    onError: (error: string) => void
}) {
    const [original, setOriginal] = useState('')
    const [source, setSource] = useState('')
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [compare, setCompare] = useState(false)
    const [confirm, setConfirm] = useState(false)
    const [status, setStatus] = useState('')
    const dirty = source !== original
    const summary = useMemo(() => sourceChangeSummary(original, source), [original, source])
    const load = useCallback(async () => {
        setLoading(true)
        try { const ddl = await GetObjectDDL(connId, kind, schema, name); setOriginal(ddl); setSource(ddl); setStatus('') }
        catch (error) { onError(String(error)) } finally { setLoading(false) }
    }, [connId, kind, name, onError, schema])
    useEffect(() => { void load() }, [load])

    const apply = async () => {
        setConfirm(false); setBusy(true); setStatus('Applying source...')
        try {
            await ApplyObjectSource(connId, kind, schema, name, source)
            const ddl = await GetObjectDDL(connId, kind, schema, name)
            setOriginal(ddl); setSource(ddl); setStatus('Source applied successfully.')
        } catch (error) { onError(String(error)); setStatus(`Failed: ${error}`) } finally { setBusy(false) }
    }
    const close = () => { if (!dirty || window.confirm('Discard unsaved source changes?')) onClose() }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && close()}>
        <div className="modal object-source-dialog">
            <div className="object-source-title"><Code2 size={17} /><div><h2>Edit {kind[0].toUpperCase() + kind.slice(1)} Source</h2><span>{schema}.{name}</span></div><div className="object-source-modes"><button className={!compare ? 'active' : ''} onClick={() => setCompare(false)}><Code2 size={12} /> Editor</button><button className={compare ? 'active' : ''} onClick={() => setCompare(true)}><Columns2 size={12} /> Compare</button></div></div>
            <div className="object-source-toolbar"><button onClick={() => void load()} disabled={loading || busy || dirty} title={dirty ? 'Discard or apply changes before reloading' : 'Reload source'}><RefreshCw size={12} /> Reload</button><span>{dirty ? `${summary.changed} changed, ${summary.added} added, ${summary.removed} removed lines` : 'No changes'}</span><div className="tb-spacer" /><button onClick={() => setSource(original)} disabled={!dirty || busy}>Revert</button><button className="primary" onClick={() => setConfirm(true)} disabled={!dirty || readOnly || busy || !source.trim()}><Save size={12} /> Apply Source</button></div>
            {loading ? <div className="grid-status">Loading object source...</div> : compare ? <div className="object-source-compare"><section><h3>Database</h3><pre>{original}</pre></section><section><h3>Edited</h3><pre>{source}</pre></section></div> : <div className="object-source-editor"><SqlEditor engine={engine} value={source} onChange={setSource} onRun={() => {}} onFormatError={onError} /></div>}
            {engine === 'mysql' && (kind === 'routine' || kind === 'trigger') && <div className="migration-warning">MySQL replaces this {kind} with DROP then CREATE and may leave it absent if the new source fails.</div>}
            {readOnly && <div className="migration-warning">Source editing is disabled because this connection is read-only.</div>}
            {status && <div className="dialog-status">{status}</div>}
            <div className="modal-buttons"><span>{engine === 'postgres' ? 'PostgreSQL applies source transactionally.' : 'MySQL object DDL may commit implicitly.'}</span><div className="spacer" /><button onClick={close} disabled={busy}>Close</button></div>
        </div>
        {confirm && <ConfirmDialog title={`Apply source for “${name}”?`} message={engine === 'mysql' && (kind === 'routine' || kind === 'trigger') ? `The existing ${kind} will be dropped before the edited definition is created. MySQL cannot roll this operation back.` : kind === 'trigger' ? 'The trigger will be replaced transactionally using the target table in the edited definition.' : 'The edited definition will replace the current database object source.'} confirmLabel="Apply Source" danger={engine === 'mysql' && (kind === 'routine' || kind === 'trigger')} onCancel={() => setConfirm(false)} onConfirm={() => void apply()} />}
    </div>
}
