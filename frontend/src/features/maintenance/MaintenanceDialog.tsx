import { useState } from 'react'
import { Activity, CheckCircle2, DatabaseZap, Gauge, RefreshCw } from 'lucide-react'
import { MaintainTable } from '../../../wailsjs/go/api/App'
import ConfirmDialog from '../../components/ConfirmDialog'

interface Operation { id: string; label: string; description: string; icon: typeof Activity; intensive?: boolean }

const postgresOperations: Operation[] = [
    { id: 'analyze', label: 'Analyze', description: 'Refresh planner statistics from a sample of table rows.', icon: Gauge },
    { id: 'vacuum', label: 'Vacuum + Analyze', description: 'Reclaim dead tuples where possible and refresh planner statistics.', icon: RefreshCw, intensive: true },
    { id: 'reindex', label: 'Reindex Table', description: 'Rebuild every index belonging to this table.', icon: DatabaseZap, intensive: true },
]
const mysqlOperations: Operation[] = [
    { id: 'analyze', label: 'Analyze Table', description: 'Refresh key distribution statistics used by the optimizer.', icon: Gauge },
    { id: 'check', label: 'Check Table', description: 'Check the table and its indexes for engine-reported errors.', icon: CheckCircle2 },
    { id: 'optimize', label: 'Optimize Table', description: 'Reorganize storage and reclaim unused table space.', icon: DatabaseZap, intensive: true },
]

export default function MaintenanceDialog({ connId, engine, schema, table, readOnly, onClose, onError }: {
    connId: string
    engine: string
    schema: string
    table: string
    readOnly: boolean
    onClose: () => void
    onError: (message: string) => void
}) {
    const operations = engine === 'mysql' ? mysqlOperations : postgresOperations
    const [pending, setPending] = useState<Operation | null>(null)
    const [running, setRunning] = useState<string | null>(null)
    const [result, setResult] = useState('')

    const run = async () => {
        if (!pending) return
        const operation = pending
        setPending(null)
        setRunning(operation.id)
        setResult('')
        try {
            setResult(await MaintainTable(connId, schema, table, operation.id))
        } catch (error) {
            onError(String(error))
        } finally {
            setRunning(null)
        }
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !running && onClose()}>
        <div className="modal maintenance-dialog">
            <div className="maintenance-title"><div><h2>Table Maintenance</h2><span>{schema}.{table}</span></div><button className="icon-btn" onClick={onClose} disabled={!!running} title="Close">x</button></div>
            <div className="maintenance-operations">
                {operations.map(operation => { const Icon = operation.icon; return <button key={operation.id} className="maintenance-operation" disabled={readOnly || !!running} onClick={() => setPending(operation)}>
                    <Icon size={18} /><span><strong>{operation.label}</strong><small>{operation.description}</small></span>
                    {running === operation.id && <span className="maintenance-running">Running...</span>}
                </button> })}
            </div>
            {readOnly && <div className="migration-warning">Maintenance is disabled because this connection is read-only.</div>}
            {result && <div className="maintenance-result"><CheckCircle2 size={14} /> {result}</div>}
            <div className="modal-buttons"><span>Maintenance may lock tables or increase server load.</span><div className="spacer" /><button onClick={onClose} disabled={!!running}>Close</button></div>
        </div>
        {pending && <ConfirmDialog title={`Run ${pending.label}?`} message={`${pending.description} This operation may affect table performance while it runs.`} confirmLabel="Run Maintenance" danger={!!pending.intensive} onCancel={() => setPending(null)} onConfirm={run} />}
    </div>
}
