import { useMemo, useState } from 'react'
import { Link2, Plus, Trash2 } from 'lucide-react'
import { saveVirtualForeignKey, VirtualForeignKey } from './virtualForeignKeys'

interface Mapping { source: string; target: string }

function generatedName(source: string, target: string) {
    const sourceTable = source.split('.').at(-1) ?? source
    const targetTable = target.split('.').at(-1) ?? target
    return `virtual_${sourceTable}_${targetTable}`.replace(/[^a-zA-Z0-9_]/g, '_')
}

export default function VirtualForeignKeyDialog({ connId, currentName, autocomplete, onClose, onSave }: {
    connId: string
    currentName: string
    autocomplete: Record<string, string[]>
    onClose: () => void
    onSave: (key: VirtualForeignKey) => void
}) {
    const tables = useMemo(() => [...new Set([currentName, ...Object.keys(autocomplete)])].sort(), [autocomplete, currentName])
    const initialTarget = tables.find(table => table !== currentName) ?? currentName
    const [source, setSource] = useState(currentName)
    const [target, setTarget] = useState(initialTarget)
    const [name, setName] = useState(() => generatedName(currentName, initialTarget))
    const [mappings, setMappings] = useState<Mapping[]>([{ source: autocomplete[currentName]?.[0] ?? '', target: autocomplete[initialTarget]?.[0] ?? '' }])
    const [error, setError] = useState('')
    const updateTable = (kind: 'source' | 'target', table: string) => {
        if (kind === 'source') setSource(table)
        else setTarget(table)
        const nextSource = kind === 'source' ? table : source
        const nextTarget = kind === 'target' ? table : target
        setName(generatedName(nextSource, nextTarget))
        setMappings([{ source: autocomplete[nextSource]?.[0] ?? '', target: autocomplete[nextTarget]?.[0] ?? '' }])
    }
    const submit = () => {
        try {
            const key = saveVirtualForeignKey({ connId, name, source, target, sourceColumns: mappings.map(mapping => mapping.source), targetColumns: mappings.map(mapping => mapping.target) })
            onSave(key)
        } catch (reason) { setError(String(reason)) }
    }
    const valid = name.trim() && source && target && mappings.length > 0 && mappings.every(mapping => mapping.source && mapping.target)

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
        <div className="modal virtual-fk-dialog">
            <div className="virtual-fk-title"><Link2 size={16} /><div><h2>Virtual Foreign Key</h2><span>Local relationship metadata; the database schema is not changed.</span></div></div>
            <div className="virtual-fk-fields">
                <label><span>Name</span><input value={name} onChange={event => setName(event.target.value)} /></label>
                <label><span>Referencing table</span><select value={source} onChange={event => updateTable('source', event.target.value)}>{tables.map(table => <option key={table}>{table}</option>)}</select></label>
                <label><span>Referenced table</span><select value={target} onChange={event => updateTable('target', event.target.value)}>{tables.map(table => <option key={table}>{table}</option>)}</select></label>
            </div>
            <div className="virtual-fk-mappings">
                <div className="virtual-fk-heading"><span>Referencing column</span><span>Referenced column</span><span /></div>
                {mappings.map((mapping, index) => <div className="virtual-fk-mapping" key={index}>
                    <select value={mapping.source} onChange={event => setMappings(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value } : item))}><option value="">Choose column...</option>{(autocomplete[source] ?? []).map(column => <option key={column}>{column}</option>)}</select>
                    <select value={mapping.target} onChange={event => setMappings(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value } : item))}><option value="">Choose column...</option>{(autocomplete[target] ?? []).map(column => <option key={column}>{column}</option>)}</select>
                    <button className="icon-btn" disabled={mappings.length === 1} onClick={() => setMappings(items => items.filter((_, itemIndex) => itemIndex !== index))} title="Remove column mapping"><Trash2 size={12} /></button>
                </div>)}
                <button className="virtual-fk-add" onClick={() => setMappings(items => [...items, { source: '', target: '' }])}><Plus size={12} /> Add Column Mapping</button>
            </div>
            {error && <div className="dialog-status error">{error}</div>}
            <div className="modal-buttons"><div className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={!valid} onClick={submit}>Create Relationship</button></div>
        </div>
    </div>
}
