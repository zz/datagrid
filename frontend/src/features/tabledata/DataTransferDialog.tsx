import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { ApplyChangeset, LoadTableRows, OpenTable } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import type { Value } from '../../ipc/types'
import { Tab, useApp } from '../../store'
import { deferredTransferCells, missingRequiredColumns, suggestedTransferMapping, transferRows } from './dataTransfer'

type Scope = 'page' | 'filtered'

export default function DataTransferDialog({ tab, onClose }: { tab: Tab; onClose: () => void }) {
    const view = useApp(state => state.tableViews[tab.id])
    const connections = useApp(state => state.connections)
    const connected = useApp(state => state.connected)
    const autocomplete = useApp(state => state.autocomplete)
    const setError = useApp(state => state.setError)
    const targets = useMemo(() => connections.filter(connection => connected[connection.id] && connection.engine !== 'redis'), [connections, connected])
    const [targetConnId, setTargetConnId] = useState(() => targets.find(connection => connection.id !== tab.connId)?.id ?? targets[0]?.id ?? '')
    const [targetName, setTargetName] = useState('')
    const [targetInfo, setTargetInfo] = useState<drivers.TableInfo | null>(null)
    const [mapping, setMapping] = useState<Record<string, string>>({})
    const [scope, setScope] = useState<Scope>('page')
    const [busy, setBusy] = useState(false)
    const [loadingTarget, setLoadingTarget] = useState(false)
    const [status, setStatus] = useState('')
    const tableNames = useMemo(() => Object.keys(autocomplete[targetConnId] ?? {}).sort().filter(name => targetConnId !== tab.connId || name !== `${tab.schema}.${tab.table}`), [autocomplete, targetConnId, tab.connId, tab.schema, tab.table])
    const targetConnection = connections.find(connection => connection.id === targetConnId)

    useEffect(() => {
        setTargetName('')
        setTargetInfo(null)
        setMapping({})
    }, [targetConnId])

    useEffect(() => {
        if (!targetName || !view) return
        const separator = targetName.indexOf('.')
        const schema = separator < 0 ? '' : targetName.slice(0, separator)
        const table = separator < 0 ? targetName : targetName.slice(separator + 1)
        let active = true
        setLoadingTarget(true)
        setTargetInfo(null)
        OpenTable(targetConnId, schema, table).then(info => {
            if (!active) return
            setTargetInfo(info)
            setMapping(suggestedTransferMapping(view.columns, info.columns))
        }).catch(error => setError(String(error))).finally(() => active && setLoadingTarget(false))
        return () => { active = false }
    }, [setError, targetConnId, targetName, view])

    if (!view) return null
    const missing = targetInfo ? missingRequiredColumns(targetInfo.columns, mapping) : []
    const mappedCount = Object.values(mapping).filter(Boolean).length
    const previewRows = transferRows(view.columns, view.rows.slice(0, 4), mapping)
    const deferred = deferredTransferCells(view.rows)
    const canTransfer = !!targetInfo && !targetConnection?.readOnly && mappedCount > 0 && missing.length === 0 && (scope !== 'page' || deferred === 0) && view.rows.length > 0

    const transfer = async () => {
        if (!targetInfo) return
        setBusy(true)
        setStatus('Loading source rows...')
        try {
            let rows = view.rows
            let limited = false
            if (scope === 'filtered') {
                const page = await LoadTableRows(tab.connId, drivers.PageRequest.createFrom({
                    schema: tab.schema ?? '', table: tab.table ?? '', whereRaw: view.whereRaw, sorts: view.sorts,
                    filters: view.filters, limit: 1000, offset: 0,
                }))
                rows = page.rows as Value[][]
                limited = page.hasMore
            }
            const deferredCount = deferredTransferCells(rows)
            if (deferredCount) throw new Error(`${deferredCount} large value${deferredCount === 1 ? '' : 's'} must be loaded before transfer.`)
            setStatus(`Inserting ${rows.length.toLocaleString()} rows...`)
            const sets = transferRows(view.columns, rows, mapping)
            const changes = sets.map(set => drivers.RowChange.createFrom({ kind: 'insert', key: {}, set }))
            const result = await ApplyChangeset(targetConnId, drivers.ChangesetRequest.createFrom({
                schema: targetInfo.schema, table: targetInfo.table, changes,
            }))
            setStatus(`Inserted ${result.rowsAffected.toLocaleString()} rows${limited ? '; additional matching rows were not transferred' : ''}.`)
        } catch (error) {
            setError(String(error))
            setStatus(`Failed: ${error}`)
        } finally { setBusy(false) }
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
        <div className="modal data-transfer-dialog">
            <div className="test-data-title"><ArrowRightLeft size={17} /><div><h2>Transfer Data</h2><span>{tab.schema}.{tab.table}</span></div></div>
            <div className="data-transfer-targets">
                <label>Connection<select value={targetConnId} onChange={event => setTargetConnId(event.target.value)}>{targets.map(connection => <option key={connection.id} value={connection.id}>{connection.name} ({connection.engine})</option>)}</select></label>
                <label>Target table<select value={targetName} onChange={event => setTargetName(event.target.value)} disabled={!targetConnId}><option value="">Select a table...</option>{tableNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
                <label>Rows<select value={scope} onChange={event => setScope(event.target.value as Scope)}><option value="page">Current page ({view.rows.length})</option><option value="filtered">Matching filters (up to 1,000)</option></select></label>
            </div>
            {loadingTarget ? <div className="grid-status">Loading target structure...</div> : targetInfo ? <>
                <div className="data-transfer-body">
                    <section><h3>Column Mapping</h3><div className="data-transfer-mapping"><div className="heading"><span>Target column</span><span>Target type</span><span>Source column</span></div>{targetInfo.columns.map(column => <div key={column.name}><strong>{column.name}{!column.nullable && !column.default && <small>required</small>}</strong><code>{column.typeName}</code><select value={mapping[column.name] ?? ''} onChange={event => setMapping(current => ({ ...current, [column.name]: event.target.value }))}><option value="">Omit / server default</option>{view.columns.map(source => <option key={source.name} value={source.name}>{source.name} ({source.typeName})</option>)}</select></div>)}</div></section>
                    <section><h3>Preview</h3><div className="data-transfer-preview"><table><thead><tr>{targetInfo.columns.filter(column => mapping[column.name]).map(column => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{previewRows.map((row, index) => <tr key={index}>{targetInfo.columns.filter(column => mapping[column.name]).map(column => <td key={column.name}>{row[column.name]?.null ? 'NULL' : row[column.name]?.text ?? ''}</td>)}</tr>)}</tbody></table></div><p>{mappedCount} of {targetInfo.columns.length} target columns mapped.</p></section>
                </div>
                {targetConnection?.readOnly && <div className="migration-warning">The target connection is read-only.</div>}
                {missing.length > 0 && <div className="migration-warning">Required target columns are not mapped: {missing.join(', ')}.</div>}
                {deferred > 0 && scope === 'page' && <div className="migration-warning">Load the {deferred} deferred large value{deferred === 1 ? '' : 's'} before transferring this page.</div>}
            </> : <div className="data-transfer-empty">Choose an existing target table to configure the transfer.</div>}
            {status && <div className="dialog-status">{status}</div>}
            <div className="modal-buttons"><span>Values are converted through the target driver and inserted as one changeset.</span><div className="spacer" /><button onClick={onClose} disabled={busy}>Close</button><button className="primary" onClick={() => void transfer()} disabled={busy || !canTransfer}>{busy ? 'Transferring...' : 'Transfer Rows'}</button></div>
        </div>
    </div>
}
