import { useMemo, useState } from 'react'
import { CheckSquare, Clipboard, Code2, SquareTerminal } from 'lucide-react'
import { Copy } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp } from '../../store'
import { GeneratedStatementKind, generateTableSQL } from './sqlGeneration'

const KINDS: Array<{ value: GeneratedStatementKind; label: string }> = [
    { value: 'select', label: 'SELECT' }, { value: 'insert', label: 'INSERT' }, { value: 'update', label: 'UPDATE' },
    { value: 'delete', label: 'DELETE' }, { value: 'upsert', label: 'UPSERT' },
]

export default function SQLGeneratorDialog({ connId, engine, info, onClose }: { connId: string; engine: string; info: drivers.TableInfo; onClose: () => void }) {
    const openQueryTab = useApp(state => state.openQueryTab)
    const [kind, setKind] = useState<GeneratedStatementKind>('select')
    const defaultColumns = info.columns.filter(column => !column.default || info.primaryKey.includes(column.name)).map(column => column.name)
    const [selected, setSelected] = useState<string[]>(defaultColumns.length ? defaultColumns : info.columns.map(column => column.name))
    const sql = useMemo(() => generateTableSQL(engine, info, kind, selected), [engine, info, kind, selected])
    const toggle = (name: string) => setSelected(current => current.includes(name) ? current.filter(column => column !== name) : [...current, name])
    const mutableSelected = selected.some(column => !info.primaryKey.includes(column))
    const invalid = (kind !== 'delete' && selected.length === 0) || ((kind === 'update' || kind === 'upsert') && !mutableSelected)

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
        <div className="modal sql-generator-dialog">
            <div className="object-source-title"><Code2 size={17} /><div><h2>Generate SQL</h2><span>{info.schema}.{info.table}</span></div></div>
            <div className="sql-generator-kinds">{KINDS.map(item => <button key={item.value} className={kind === item.value ? 'active' : ''} onClick={() => setKind(item.value)}>{item.label}</button>)}</div>
            <div className="sql-generator-body"><section><div className="sql-generator-heading">Columns <button onClick={() => setSelected(info.columns.map(column => column.name))}>All</button><button onClick={() => setSelected(defaultColumns)}>Without defaults</button></div><div className="sql-generator-columns">{info.columns.map(column => <label key={column.name}><input type="checkbox" checked={selected.includes(column.name)} onChange={() => toggle(column.name)} /><span><strong>{column.name}</strong><small>{column.typeName}{info.primaryKey.includes(column.name) ? ' / PK' : column.default ? ' / default' : ''}</small></span></label>)}</div></section><section><div className="sql-generator-heading">Preview <span>{engine === 'mysql' ? 'MySQL' : 'PostgreSQL'}</span></div><textarea value={invalid ? '-- Select at least one writable column.' : sql} readOnly spellCheck={false} /></section></div>
            <div className="modal-buttons"><span><CheckSquare size={12} /> Named parameters are resolved when the console runs.</span><div className="spacer" /><button onClick={onClose}>Close</button><button onClick={() => Copy(sql)} disabled={invalid}><Clipboard size={12} /> Copy</button><button className="primary" disabled={invalid} onClick={() => { openQueryTab(connId, sql, `${info.table} ${kind.toUpperCase()}`); onClose() }}><SquareTerminal size={12} /> Open in Console</button></div>
        </div>
    </div>
}
