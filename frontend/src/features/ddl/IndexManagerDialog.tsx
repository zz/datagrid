import { useEffect, useState } from 'react'
import { ListIndexes, CreateIndex, DropIndex, OpenTable } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'

// IndexManagerDialog is the DataGrip-style "Indexes" editor: it lists a table's
// indexes, lets you drop them, and create new ones from the table's columns.
export default function IndexManagerDialog({
    connId,
    schema,
    table,
    readOnly,
    onClose,
    onError,
    onChanged,
}: {
    connId: string
    schema?: string
    table: string
    readOnly: boolean
    onClose: () => void
    onError: (msg: string) => void
    onChanged: () => void
}) {
    const [indexes, setIndexes] = useState<drivers.IndexInfo[] | null>(null)
    const [columns, setColumns] = useState<string[]>([])
    const [name, setName] = useState('')
    const [unique, setUnique] = useState(false)
    const [picked, setPicked] = useState<string[]>([])
    const [confirmDrop, setConfirmDrop] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const refresh = () => {
        ListIndexes(connId, schema ?? '', table)
            .then(l => setIndexes(l ?? []))
            .catch(e => {
                onError(String(e))
                setIndexes([])
            })
    }

    useEffect(() => {
        refresh()
        OpenTable(connId, schema ?? '', table)
            .then(info => setColumns((info?.columns ?? []).map(c => c.name)))
            .catch(() => {})
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connId, schema, table])

    // Suggest an index name from the picked columns when the user hasn't typed one.
    const suggestedName = picked.length ? `idx_${table}_${picked.join('_')}` : ''
    const effectiveName = name.trim() || suggestedName
    const canCreate = !readOnly && !busy && effectiveName !== '' && picked.length > 0

    const togglePick = (col: string) =>
        setPicked(p => (p.includes(col) ? p.filter(c => c !== col) : [...p, col]))

    const create = async () => {
        setBusy(true)
        try {
            await CreateIndex(connId, schema ?? '', table, drivers.IndexSpec.createFrom({ name: effectiveName, columns: picked, unique }))
            setName('')
            setPicked([])
            setUnique(false)
            refresh()
            onChanged()
        } catch (e) {
            onError(String(e))
        } finally {
            setBusy(false)
        }
    }

    const drop = async (indexName: string) => {
        setConfirmDrop(null)
        setBusy(true)
        try {
            await DropIndex(connId, schema ?? '', table, indexName)
            refresh()
            onChanged()
        } catch (e) {
            onError(String(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal ddl-dialog">
                <h2>Indexes on {schema ? `${schema}.${table}` : table}</h2>
                {readOnly && <div className="table-banner">This connection is read-only; indexes can’t be changed.</div>}

                <div className="index-list">
                    {indexes === null ? (
                        <div className="tree-loading">loading…</div>
                    ) : indexes.length === 0 ? (
                        <div className="tree-loading">No indexes.</div>
                    ) : (
                        indexes.map(ix => (
                            <div className="index-row" key={ix.name}>
                                <span className="index-name">{ix.name}</span>
                                {ix.unique && <span className="index-badge">unique</span>}
                                <span className="index-cols">({(ix.columns ?? []).join(', ')})</span>
                                <span className="spacer" />
                                {confirmDrop === ix.name ? (
                                    <>
                                        <button className="danger" disabled={busy} onClick={() => drop(ix.name)}>
                                            Confirm drop
                                        </button>
                                        <button onClick={() => setConfirmDrop(null)}>Cancel</button>
                                    </>
                                ) : (
                                    <button className="icon-btn" title="Drop index" disabled={readOnly || busy} onClick={() => setConfirmDrop(ix.name)}>
                                        🗑
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="index-create">
                    <div className="index-create-title">New index</div>
                    <label className="ddl-field">
                        <span>Name</span>
                        <input value={name} placeholder={suggestedName || 'index_name'} disabled={readOnly} onChange={e => setName(e.target.value)} />
                    </label>
                    <div className="ddl-field">
                        <span>Columns</span>
                        <div className="index-col-picker">
                            {columns.map(c => (
                                <label key={c} className={`index-col-chip ${picked.includes(c) ? 'on' : ''}`}>
                                    <input type="checkbox" checked={picked.includes(c)} disabled={readOnly} onChange={() => togglePick(c)} />
                                    {c}
                                </label>
                            ))}
                        </div>
                    </div>
                    <label className="ddl-check">
                        <input type="checkbox" checked={unique} disabled={readOnly} onChange={e => setUnique(e.target.checked)} />
                        Unique
                    </label>
                </div>

                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onClose}>Close</button>
                    <button className="primary" disabled={!canCreate} onClick={create}>
                        Create index
                    </button>
                </div>
            </div>
        </div>
    )
}
