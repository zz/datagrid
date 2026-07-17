import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Search } from 'lucide-react'
import { LoadTableRows } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import type { Column, Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'
import type { ResultForeignKey } from './foreignKeyResultActions'

export default function ForeignKeyLookupDialog({ connId, foreignKey, onCancel, onSelect }: {
    connId: string
    foreignKey: ResultForeignKey
    onCancel: () => void
    onSelect: (columns: Column[], row: Value[]) => void
}) {
    const [columns, setColumns] = useState<Column[]>([])
    const [rows, setRows] = useState<Value[][]>([])
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState(-1)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        let active = true
        setLoading(true); setError('')
        LoadTableRows(connId, drivers.PageRequest.createFrom({
            schema: foreignKey.referencedSchema,
            table: foreignKey.referencedTable,
            whereRaw: '', sorts: [], filters: [], limit: 200, offset: 0,
        })).then(page => {
            if (!active) return
            setColumns(page.columns ?? []); setRows(page.rows ?? []); setSelected(page.rows?.length ? 0 : -1)
        }).catch(reason => active && setError(String(reason))).finally(() => active && setLoading(false))
        return () => { active = false }
    }, [connId, foreignKey])

    const visibleRows = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return rows.map((row, sourceIndex) => ({ row, sourceIndex }))
        return rows.flatMap((row, sourceIndex) => row.some(value => value.t !== 'null' && displayValue(value).toLowerCase().includes(needle)) ? [{ row, sourceIndex }] : [])
    }, [query, rows])
    const shownColumns = useMemo(() => {
        const keys = new Set(foreignKey.referencedColumns)
        const indexed = columns.map((column, index) => ({ column, index }))
        return [...indexed.filter(({ column }) => keys.has(column.name)), ...indexed.filter(({ column }) => !keys.has(column.name))].slice(0, 8)
    }, [columns, foreignKey.referencedColumns])
    const selectedRow = rows[selected]

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
        <div className="modal foreign-key-lookup-dialog" role="dialog" aria-modal="true" aria-label="Choose referenced row">
            <div className="foreign-key-lookup-title"><KeyRound size={17} /><div><h2>Choose Referenced Row</h2><span>{foreignKey.referencedSchema}.{foreignKey.referencedTable} · {foreignKey.name}</span></div></div>
            <label className="foreign-key-lookup-search"><Search size={13} /><input autoFocus placeholder="Filter loaded rows" value={query} onChange={event => { setQuery(event.target.value); setSelected(-1) }} /></label>
            <div className="foreign-key-lookup-table"><table><thead><tr>{shownColumns.map(({ column }) => <th key={column.name}>{column.name}{foreignKey.referencedColumns.includes(column.name) && <small>FK</small>}</th>)}</tr></thead><tbody>
                {visibleRows.map(({ row, sourceIndex }) => <tr key={sourceIndex} className={selected === sourceIndex ? 'selected' : ''} onClick={() => setSelected(sourceIndex)} onDoubleClick={() => onSelect(columns, row)}>{shownColumns.map(({ column, index }) => { const value = row[index]; return <td key={column.name} className={value?.t === 'null' ? 'null' : ''}>{value?.t === 'null' ? 'NULL' : displayValue(value ?? { t: 'null' })}</td> })}</tr>)}
            </tbody></table>{!loading && !error && visibleRows.length === 0 && <div className="foreign-key-lookup-empty">No matching referenced rows.</div>}</div>
            {loading && <div className="dialog-status">Loading referenced rows...</div>}
            {error && <div className="result-edit-error">{error}</div>}
            <div className="modal-buttons"><span>{rows.length.toLocaleString()} loaded · showing up to 200 rows</span><div className="spacer" /><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!selectedRow} onClick={() => selectedRow && onSelect(columns, selectedRow)}>Use Row</button></div>
        </div>
    </div>
}
