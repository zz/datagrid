import { useState } from 'react'

// Column type presets per engine. The field is free-text (with suggestions),
// so anything the engine accepts still works.
const TYPE_PRESETS: Record<string, string[]> = {
    postgres: ['integer', 'bigint', 'bigserial', 'text', 'varchar(255)', 'boolean', 'numeric', 'timestamptz', 'date', 'jsonb', 'uuid'],
    mysql: ['int', 'bigint', 'varchar(255)', 'text', 'tinyint(1)', 'decimal(10,2)', 'datetime', 'date', 'json', 'double'],
}

export interface ColumnDraft {
    name: string
    type: string
    nullable: boolean
    primaryKey: boolean
    default: string
}

const emptyColumn = (): ColumnDraft => ({ name: '', type: '', nullable: false, primaryKey: false, default: '' })

// ColumnFields renders the editable grid of column definitions shared by the
// create-table dialog. onChange receives the full list on every edit.
function ColumnFields({
    engine,
    columns,
    onChange,
}: {
    engine: string
    columns: ColumnDraft[]
    onChange: (cols: ColumnDraft[]) => void
}) {
    const presets = TYPE_PRESETS[engine] ?? TYPE_PRESETS.postgres
    const set = (i: number, patch: Partial<ColumnDraft>) =>
        onChange(columns.map((c, j) => (j === i ? { ...c, ...patch } : c)))
    return (
        <div className="col-editor">
            <datalist id="ddl-types">
                {presets.map(t => (
                    <option key={t} value={t} />
                ))}
            </datalist>
            <div className="col-editor-head">
                <span>Name</span>
                <span>Type</span>
                <span title="Primary key">PK</span>
                <span title="Allow NULL">Null</span>
                <span>Default</span>
                <span />
            </div>
            {columns.map((c, i) => (
                <div className="col-editor-row" key={i}>
                    <input value={c.name} placeholder="column" onChange={e => set(i, { name: e.target.value })} />
                    <input list="ddl-types" value={c.type} placeholder="type" onChange={e => set(i, { type: e.target.value })} />
                    <input type="checkbox" checked={c.primaryKey} onChange={e => set(i, { primaryKey: e.target.checked })} />
                    <input type="checkbox" checked={c.nullable} onChange={e => set(i, { nullable: e.target.checked })} />
                    <input value={c.default} placeholder="—" onChange={e => set(i, { default: e.target.value })} />
                    <button
                        className="icon-btn"
                        title="Remove column"
                        disabled={columns.length === 1}
                        onClick={() => onChange(columns.filter((_, j) => j !== i))}
                    >
                        ×
                    </button>
                </div>
            ))}
            <button className="col-editor-add" onClick={() => onChange([...columns, emptyColumn()])}>
                + Add column
            </button>
        </div>
    )
}

// CreateTableDialog collects a table name and its columns, then hands a spec
// back to the caller to execute.
export function CreateTableDialog({
    engine,
    schema,
    onCancel,
    onSubmit,
}: {
    engine: string
    schema?: string
    onCancel: () => void
    onSubmit: (name: string, columns: ColumnDraft[]) => void
}) {
    const [name, setName] = useState('')
    const [columns, setColumns] = useState<ColumnDraft[]>([{ ...emptyColumn(), name: 'id', type: engine === 'mysql' ? 'bigint' : 'bigserial', primaryKey: true }])
    const valid = name.trim() !== '' && columns.every(c => c.name.trim() && c.type.trim())
    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
            <div className="modal ddl-dialog">
                <h2>New table{schema ? ` in ${schema}` : ''}</h2>
                <label className="ddl-field">
                    <span>Table name</span>
                    <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="table_name" />
                </label>
                <ColumnFields engine={engine} columns={columns} onChange={setColumns} />
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onCancel}>Cancel</button>
                    <button className="primary" disabled={!valid} onClick={() => onSubmit(name.trim(), columns)}>
                        Create table
                    </button>
                </div>
            </div>
        </div>
    )
}

// AddColumnDialog collects a single column definition to add to a table.
export function AddColumnDialog({
    engine,
    table,
    onCancel,
    onSubmit,
}: {
    engine: string
    table: string
    onCancel: () => void
    onSubmit: (col: ColumnDraft) => void
}) {
    const [col, setCol] = useState<ColumnDraft>({ ...emptyColumn(), nullable: true })
    const presets = TYPE_PRESETS[engine] ?? TYPE_PRESETS.postgres
    const valid = col.name.trim() !== '' && col.type.trim() !== ''
    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
            <div className="modal ddl-dialog">
                <h2>Add column to {table}</h2>
                <datalist id="ddl-types-add">
                    {presets.map(t => (
                        <option key={t} value={t} />
                    ))}
                </datalist>
                <label className="ddl-field">
                    <span>Name</span>
                    <input autoFocus value={col.name} onChange={e => setCol({ ...col, name: e.target.value })} placeholder="column" />
                </label>
                <label className="ddl-field">
                    <span>Type</span>
                    <input list="ddl-types-add" value={col.type} onChange={e => setCol({ ...col, type: e.target.value })} placeholder="type" />
                </label>
                <label className="ddl-field">
                    <span>Default</span>
                    <input value={col.default} onChange={e => setCol({ ...col, default: e.target.value })} placeholder="— (none)" />
                </label>
                <label className="ddl-check">
                    <input type="checkbox" checked={col.nullable} onChange={e => setCol({ ...col, nullable: e.target.checked })} />
                    Allow NULL
                </label>
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onCancel}>Cancel</button>
                    <button className="primary" disabled={!valid} onClick={() => onSubmit(col)}>
                        Add column
                    </button>
                </div>
            </div>
        </div>
    )
}
