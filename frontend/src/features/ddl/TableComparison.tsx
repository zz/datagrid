import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { ApplyMigration, OpenTable } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useApp } from '../../store'
import { compareColumns, compareMetadata, targetDrafts } from './comparison'
import { generateColumnMigration } from './migration'
import { generateMetadataMigration } from './metadataMigration'

function splitObjectName(value: string) {
    const separator = value.indexOf('.')
    return separator < 0 ? { schema: '', table: value } : { schema: value.slice(0, separator), table: value.slice(separator + 1) }
}

export default function TableComparison({
    originConnId, originEngine, originInfo, onError,
}: {
    originConnId: string
    originEngine: string
    originInfo: drivers.TableInfo
    onError: (message: string) => void
}) {
    const connections = useApp(state => state.connections)
    const connected = useApp(state => state.connected)
    const autocomplete = useApp(state => state.autocomplete)
    const sqlConnections = useMemo(
        () => connections.filter(connection => connected[connection.id] && connection.engine !== 'redis'),
        [connections, connected],
    )
    const [targetConnId, setTargetConnId] = useState(originConnId)
    const [targetName, setTargetName] = useState('')
    const [targetInfo, setTargetInfo] = useState<drivers.TableInfo | null>(null)
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [confirm, setConfirm] = useState(false)

    const targetConnection = connections.find(connection => connection.id === targetConnId)
    const originName = `${originInfo.schema}.${originInfo.table}`
    const targetNames = useMemo(
        () => Object.keys(autocomplete[targetConnId] ?? {}).sort().filter(name => targetConnId !== originConnId || name !== originName),
        [autocomplete, originConnId, originName, targetConnId],
    )
    const columnDifferences = useMemo(
        () => targetInfo ? compareColumns(originInfo.columns, targetInfo.columns) : [],
        [originInfo.columns, targetInfo],
    )
    const metadataDifferences = useMemo(() => targetInfo ? compareMetadata(originInfo, targetInfo) : [], [originInfo, targetInfo])
    const differences = useMemo(() => [
        ...columnDifferences.map(difference => ({ ...difference, category: 'column' as const })),
        ...metadataDifferences,
    ], [columnDifferences, metadataDifferences])
    const generated = useMemo(() => {
        if (!targetInfo || !targetConnection) return ''
        const metadata = generateMetadataMigration(targetConnection.engine, originInfo, targetInfo)
        const columnSQL = generateColumnMigration(targetConnection.engine, targetInfo.schema, targetInfo.table, targetInfo.columns, targetDrafts(originInfo.columns, targetInfo.columns))
        return [metadata.before, columnSQL, metadata.after].filter(Boolean).join('\n')
    }, [originInfo, targetConnection, targetInfo])
    const [sql, setSQL] = useState('')

    useEffect(() => setSQL(generated), [generated])
    useEffect(() => {
        setTargetInfo(null)
        setTargetName('')
    }, [targetConnId])

    const loadTarget = async (name = targetName) => {
        if (!targetConnId || !name) return
        const { schema, table } = splitObjectName(name)
        setLoading(true)
        try {
            setTargetInfo(await OpenTable(targetConnId, schema, table))
        } catch (error) {
            setTargetInfo(null)
            onError(String(error))
        } finally {
            setLoading(false)
        }
    }

    const apply = async () => {
        if (!targetInfo) return
        setBusy(true)
        try {
            await ApplyMigration(targetConnId, sql)
            await loadTarget()
        } catch (error) {
            onError(String(error))
        } finally {
            setBusy(false)
            setConfirm(false)
        }
    }

    const sameEngine = targetConnection?.engine === originEngine
    const readOnly = !!targetConnection?.readOnly
    const destructive = differences.some(difference => difference.status === 'removed' || difference.status === 'changed')

    return (
        <div className="table-comparison">
            <div className="comparison-toolbar">
                <span className="comparison-source"><strong>Source</strong> {originName}</span>
                <span className="comparison-arrow">to</span>
                <select value={targetConnId} onChange={event => setTargetConnId(event.target.value)} aria-label="Target connection">
                    {sqlConnections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
                </select>
                <select value={targetName} onChange={event => { setTargetName(event.target.value); void loadTarget(event.target.value) }} aria-label="Target table">
                    <option value="">Select target table...</option>
                    {targetNames.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <button className="icon-btn" onClick={() => void loadTarget()} disabled={!targetName || loading} title="Refresh comparison"><RefreshCw size={14} /></button>
            </div>

            {targetConnection && !sameEngine && <div className="migration-warning"><AlertTriangle size={14} /> Cross-engine comparison is preview-only because column types may not be portable.</div>}
            {targetConnection?.engine === 'mysql' && metadataDifferences.some(difference => difference.category === 'constraint' && (originInfo.constraints ?? []).some(constraint => constraint.name === difference.name && constraint.kind === 'check')) && <div className="migration-warning"><AlertTriangle size={14} /> MySQL check expressions are compared but cannot be synchronized from the currently available metadata.</div>}
            {loading ? <div className="comparison-empty">Loading target structure...</div> : !targetInfo ? (
                <div className="comparison-empty">Choose a connected table to compare columns, constraints, and indexes.</div>
            ) : (
                <div className="comparison-body">
                    <section className="comparison-differences">
                        <div className="migration-heading">Differences <span>{differences.length}</span></div>
                        {differences.length === 0 ? <div className="comparison-match"><Check size={15} /> Table structures match.</div> : differences.map(difference => (
                            <div className="comparison-difference" key={`${difference.category}-${difference.status}-${difference.name}`}>
                                <span className={`comparison-status ${difference.status}`}>{difference.status}</span>
                                <strong title={difference.category}>{difference.name}<small>{difference.category}</small></strong>
                                <span>{difference.details.join(', ')}</span>
                            </div>
                        ))}
                    </section>
                    <section className="comparison-migration">
                        <div className="migration-heading">Make Target Match Source <span>{sql ? `${sql.split(';').filter(Boolean).length} statements` : 'No changes'}</span></div>
                        <textarea value={sql} onChange={event => setSQL(event.target.value)} spellCheck={false} />
                        <div className="migration-actions">
                            <span>{readOnly ? 'Target connection is read-only.' : sameEngine ? 'Review generated DDL before applying.' : 'Application disabled across engines.'}</span>
                            <div className="tb-spacer" />
                            <button className="primary" disabled={busy || readOnly || !sameEngine || !sql.trim()} onClick={() => setConfirm(true)}>Apply to Target</button>
                        </div>
                    </section>
                </div>
            )}
            {confirm && <ConfirmDialog title="Synchronize target table?" message={destructive ? 'This migration changes or drops target columns, constraints, or indexes. Review the SQL carefully before applying.' : 'Apply the generated migration to the target table?'} confirmLabel="Apply Migration" danger={destructive} onCancel={() => setConfirm(false)} onConfirm={apply} />}
        </div>
    )
}
