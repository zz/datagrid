import { useEffect, useState } from 'react'
import {
    OpenTable,
    ListIndexes,
    AddColumn,
    ModifyColumn,
    DropColumn,
    SetPrimaryKey,
    CreateIndex,
    DropIndex,
} from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { TYPE_PRESETS } from './DdlDialogs'

type ColEdit = { from: string; name: string; type: string; nullable: boolean; default: string }

// TableStructureDialog is the DataGrip-style "Modify Table" modal. It manages a
// table's columns (edit name/type/nullable, toggle primary key, add, drop) and
// its indexes (create, drop) in one place. Each change applies immediately and
// refreshes the affected list rather than batching a diff on OK.
export default function TableStructureDialog({
    connId,
    engine,
    schema,
    table,
    readOnly,
    onClose,
    onError,
    onChanged,
}: {
    connId: string
    engine: string
    schema?: string
    table: string
    readOnly: boolean
    onClose: () => void
    onError: (msg: string) => void
    onChanged: () => void
}) {
    const [info, setInfo] = useState<drivers.TableInfo | null>(null)
    const [indexes, setIndexes] = useState<drivers.IndexInfo[] | null>(null)
    const [busy, setBusy] = useState(false)

    const [edit, setEdit] = useState<ColEdit | null>(null)
    const [dropCol, setDropCol] = useState<string | null>(null)
    const [dropIdx, setDropIdx] = useState<string | null>(null)

    const [nc, setNc] = useState({ name: '', type: '', nullable: true, default: '' })
    const [ix, setIx] = useState<{ name: string; picked: string[]; unique: boolean }>({ name: '', picked: [], unique: false })

    const presets = TYPE_PRESETS[engine] ?? TYPE_PRESETS.postgres

    const loadColumns = () =>
        OpenTable(connId, schema ?? '', table)
            .then(i => setInfo(i))
            .catch(e => onError(String(e)))
    const loadIndexes = () =>
        ListIndexes(connId, schema ?? '', table)
            .then(l => setIndexes(l ?? []))
            .catch(e => {
                onError(String(e))
                setIndexes([])
            })

    useEffect(() => {
        loadColumns()
        loadIndexes()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connId, schema, table])

    // Run a mutation, then refresh both lists + the tree, surfacing any error.
    const run = async (fn: () => Promise<void>, after: () => void) => {
        setBusy(true)
        try {
            await fn()
            after()
            await Promise.all([loadColumns(), loadIndexes()])
            onChanged()
        } catch (e) {
            onError(String(e))
        } finally {
            setBusy(false)
        }
    }

    const pk = new Set(info?.primaryKey ?? [])

    const addColumn = () =>
        run(
            () =>
                AddColumn(
                    connId,
                    schema ?? '',
                    table,
                    drivers.ColumnSpec.createFrom({ name: nc.name.trim(), type: nc.type.trim(), nullable: nc.nullable, primaryKey: false, default: nc.default }),
                ),
            () => setNc({ name: '', type: '', nullable: true, default: '' }),
        )

    const saveEdit = () => {
        if (!edit) return
        const e = edit
        if (!e.name.trim() || !e.type.trim()) return
        run(
            () =>
                ModifyColumn(
                    connId,
                    schema ?? '',
                    table,
                    e.from,
                    drivers.ColumnSpec.createFrom({ name: e.name.trim(), type: e.type.trim(), nullable: e.nullable, primaryKey: false, default: e.default }),
                ),
            () => setEdit(null),
        )
    }

    // Toggle a column's membership in the primary key, preserving key order.
    const togglePk = (col: string) => {
        const cur = info?.primaryKey ?? []
        const next = cur.includes(col) ? cur.filter(c => c !== col) : [...cur, col]
        run(() => SetPrimaryKey(connId, schema ?? '', table, next), () => {})
    }

    const suggestedIdx = ix.picked.length ? `idx_${table}_${ix.picked.join('_')}` : ''
    const createIndex = () =>
        run(
            () =>
                CreateIndex(
                    connId,
                    schema ?? '',
                    table,
                    drivers.IndexSpec.createFrom({ name: ix.name.trim() || suggestedIdx, columns: ix.picked, unique: ix.unique }),
                ),
            () => setIx({ name: '', picked: [], unique: false }),
        )
    const togglePick = (col: string) =>
        setIx(s => ({ ...s, picked: s.picked.includes(col) ? s.picked.filter(c => c !== col) : [...s.picked, col] }))

    const canAddColumn = !readOnly && !busy && nc.name.trim() !== '' && nc.type.trim() !== ''
    const canAddIndex = !readOnly && !busy && ix.picked.length > 0 && (ix.name.trim() !== '' || suggestedIdx !== '')

    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal structure-dialog">
                <h2>Modify {schema ? `${schema}.${table}` : table}</h2>
                {readOnly && <div className="table-banner">This connection is read-only; structure changes are disabled.</div>}

                <datalist id="struct-types">
                    {presets.map(t => (
                        <option key={t} value={t} />
                    ))}
                </datalist>

                {/* ---- Columns ---- */}
                <div className="struct-section-title">Columns</div>
                <div className="struct-list">
                    {info === null ? (
                        <div className="tree-loading">loading…</div>
                    ) : (
                        info.columns.map(c =>
                            edit?.from === c.name ? (
                                <div className="struct-row" key={c.name}>
                                    <input
                                        autoFocus
                                        className="struct-rename"
                                        value={edit.name}
                                        placeholder="name"
                                        onChange={ev => setEdit({ ...edit, name: ev.target.value })}
                                        onKeyDown={ev => ev.key === 'Escape' && setEdit(null)}
                                    />
                                    <input
                                        className="struct-rename"
                                        list="struct-types"
                                        value={edit.type}
                                        placeholder="type"
                                        onChange={ev => setEdit({ ...edit, type: ev.target.value })}
                                        onKeyDown={ev => ev.key === 'Escape' && setEdit(null)}
                                    />
                                    <label className="ddl-check">
                                        <input type="checkbox" checked={edit.nullable} onChange={ev => setEdit({ ...edit, nullable: ev.target.checked })} />
                                        Null
                                    </label>
                                    <button className="primary" disabled={busy} onClick={saveEdit}>
                                        Save
                                    </button>
                                    <button onClick={() => setEdit(null)}>Cancel</button>
                                </div>
                            ) : (
                                <div className="struct-row" key={c.name}>
                                    <label className="struct-pk" title="Primary key">
                                        <input type="checkbox" checked={pk.has(c.name)} disabled={readOnly || busy} onChange={() => togglePk(c.name)} />
                                        PK
                                    </label>
                                    <span className="struct-col-name">{c.name}</span>
                                    <span className="struct-col-type">{c.typeName}</span>
                                    {!c.nullable && <span className="struct-flag">NOT NULL</span>}
                                    <span className="spacer" />
                                    {dropCol === c.name ? (
                                        <>
                                            <button className="danger" disabled={busy} onClick={() => run(() => DropColumn(connId, schema ?? '', table, c.name), () => setDropCol(null))}>
                                                Confirm drop
                                            </button>
                                            <button onClick={() => setDropCol(null)}>Cancel</button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                className="icon-btn"
                                                title="Edit column"
                                                disabled={readOnly || busy}
                                                onClick={() => setEdit({ from: c.name, name: c.name, type: c.typeName, nullable: c.nullable, default: c.default })}
                                            >
                                                ✎
                                            </button>
                                            <button className="icon-btn" title="Drop column" disabled={readOnly || busy} onClick={() => setDropCol(c.name)}>
                                                🗑
                                            </button>
                                        </>
                                    )}
                                </div>
                            ),
                        )
                    )}
                </div>
                <div className="struct-add">
                    <input placeholder="new column" value={nc.name} disabled={readOnly} onChange={e => setNc({ ...nc, name: e.target.value })} />
                    <input list="struct-types" placeholder="type" value={nc.type} disabled={readOnly} onChange={e => setNc({ ...nc, type: e.target.value })} />
                    <input placeholder="default" value={nc.default} disabled={readOnly} onChange={e => setNc({ ...nc, default: e.target.value })} />
                    <label className="ddl-check">
                        <input type="checkbox" checked={nc.nullable} disabled={readOnly} onChange={e => setNc({ ...nc, nullable: e.target.checked })} />
                        Null
                    </label>
                    <button className="primary" disabled={!canAddColumn} onClick={addColumn}>
                        Add
                    </button>
                </div>

                {/* ---- Indexes ---- */}
                <div className="struct-section-title">Indexes</div>
                <div className="struct-list">
                    {indexes === null ? (
                        <div className="tree-loading">loading…</div>
                    ) : indexes.length === 0 ? (
                        <div className="tree-loading">No indexes.</div>
                    ) : (
                        indexes.map(idx => (
                            <div className="struct-row" key={idx.name}>
                                <span className="index-name">{idx.name}</span>
                                {idx.unique && <span className="index-badge">unique</span>}
                                <span className="index-cols">({(idx.columns ?? []).join(', ')})</span>
                                <span className="spacer" />
                                {dropIdx === idx.name ? (
                                    <>
                                        <button className="danger" disabled={busy} onClick={() => run(() => DropIndex(connId, schema ?? '', table, idx.name), () => setDropIdx(null))}>
                                            Confirm drop
                                        </button>
                                        <button onClick={() => setDropIdx(null)}>Cancel</button>
                                    </>
                                ) : (
                                    <button className="icon-btn" title="Drop index" disabled={readOnly || busy} onClick={() => setDropIdx(idx.name)}>
                                        🗑
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>
                <div className="struct-add">
                    <input placeholder={suggestedIdx || 'index name'} value={ix.name} disabled={readOnly} onChange={e => setIx({ ...ix, name: e.target.value })} />
                    <div className="index-col-picker">
                        {(info?.columns ?? []).map(c => (
                            <label key={c.name} className={`index-col-chip ${ix.picked.includes(c.name) ? 'on' : ''}`}>
                                <input type="checkbox" checked={ix.picked.includes(c.name)} disabled={readOnly} onChange={() => togglePick(c.name)} />
                                {c.name}
                            </label>
                        ))}
                    </div>
                    <label className="ddl-check">
                        <input type="checkbox" checked={ix.unique} disabled={readOnly} onChange={e => setIx({ ...ix, unique: e.target.checked })} />
                        Unique
                    </label>
                    <button className="primary" disabled={!canAddIndex} onClick={createIndex}>
                        Add index
                    </button>
                </div>

                <div className="modal-buttons">
                    <div className="spacer" />
                    <button className="primary" onClick={onClose}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    )
}
