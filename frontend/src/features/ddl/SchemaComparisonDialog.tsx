import { useMemo, useState } from 'react'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { ApplyMigration, GetObjectDDL, Introspect, OpenTable } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useApp } from '../../store'
import { compareColumns, compareMetadata, targetDrafts } from './comparison'
import { generateColumnMigration } from './migration'
import { generateMetadataMigration } from './metadataMigration'
import { classifySchemaTables, schemaTables, SchemaTableStatus } from './schemaComparison'
import { generateDropTable, generateMissingTableMigration } from './schemaSync'
import { normalizeObjectDDL, objectDropSQL, remapObjectDDL, SchemaObjectKind } from './objectSync'

interface ComparedTable {
    key: string
    kind: 'table' | SchemaObjectKind
    name: string
    status: SchemaTableStatus
    differenceCount: number
    create: string
    before: string
    columns: string
    after: string
    drop: string
}

async function inBatches<T, R>(items: T[], worker: (item: T) => Promise<R>, size = 6): Promise<R[]> {
    const output: R[] = []
    for (let index = 0; index < items.length; index += size) output.push(...await Promise.all(items.slice(index, index + size).map(worker)))
    return output
}

export default function SchemaComparisonDialog({ originConnId, originSchema, onClose, onError }: {
    originConnId: string
    originSchema: string
    onClose: () => void
    onError: (message: string) => void
}) {
    const connections = useApp(state => state.connections)
    const connected = useApp(state => state.connected)
    const autocomplete = useApp(state => state.autocomplete)
    const originConnection = connections.find(connection => connection.id === originConnId)
    const targets = connections.filter(connection => connected[connection.id] && connection.engine !== 'redis')
    const [targetConnId, setTargetConnId] = useState(originConnId)
    const targetConnection = connections.find(connection => connection.id === targetConnId)
    const targetSchemas = useMemo(() => [...new Set(Object.keys(autocomplete[targetConnId] ?? {}).map(name => name.split('.')[0]))].sort(), [autocomplete, targetConnId])
    const [targetSchema, setTargetSchema] = useState(() => targetSchemas.find(schema => schema !== originSchema) ?? originSchema)
    const [rows, setRows] = useState<ComparedTable[]>([])
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [confirm, setConfirm] = useState(false)

    const compare = async () => {
        if (!targetSchema) return
        setLoading(true)
        try {
            const originNames = schemaTables(autocomplete[originConnId] ?? {}, originSchema)
            const targetNames = schemaTables(autocomplete[targetConnId] ?? {}, targetSchema)
            const classified = classifySchemaTables(originNames, targetNames)
            const loadable = classified.filter(item => item.status === 'match' || item.status === 'missing-target')
            const detailed = await inBatches(loadable, async item => {
                const origin = await OpenTable(originConnId, originSchema, item.name)
                if (item.status === 'missing-target') {
                    const migration = generateMissingTableMigration(targetConnection?.engine ?? 'postgres', origin, targetSchema)
                    return { key: `table:${item.name}`, kind: 'table' as const, name: item.name, status: item.status, differenceCount: 0, create: migration.create, before: '', columns: '', after: migration.constraints, drop: '' }
                }
                const target = await OpenTable(targetConnId, targetSchema, item.name)
                const differenceCount = compareColumns(origin.columns, target.columns).length + compareMetadata(origin, target).length
                const metadata = generateMetadataMigration(targetConnection?.engine ?? 'postgres', origin, target)
                const columns = generateColumnMigration(targetConnection?.engine ?? 'postgres', target.schema, target.table, target.columns, targetDrafts(origin.columns, target.columns))
                return { key: `table:${item.name}`, kind: 'table' as const, name: item.name, status: differenceCount ? 'changed' as const : 'match' as const, differenceCount, create: '', before: metadata.before, columns, after: metadata.after, drop: '' }
            })
            const extras = classified.filter(item => item.status === 'extra-target').map(item => ({
                ...item, key: `table:${item.name}`, kind: 'table' as const, differenceCount: 0, create: '', before: '', columns: '', after: '',
                drop: generateDropTable(targetConnection?.engine ?? 'postgres', targetSchema, item.name),
            }))
            const kinds: SchemaObjectKind[] = targetConnection?.engine === 'postgres' ? ['view', 'sequence', 'routine', 'trigger'] : ['view', 'routine', 'trigger']
            const objectRows = (await Promise.all(kinds.map(async kind => {
                const [originTree, targetTree] = await Promise.all([
                    Introspect(originConnId, drivers.IntrospectScope.createFrom({ schema: originSchema, category: kind })),
                    Introspect(targetConnId, drivers.IntrospectScope.createFrom({ schema: targetSchema, category: kind })),
                ])
                const originNodes = new Map((originTree.nodes ?? []).map(node => [node.name, node]))
                const targetNodes = new Map((targetTree.nodes ?? []).map(node => [node.name, node]))
                const objectPresence = classifySchemaTables([...originNodes.keys()], [...targetNodes.keys()])
                return inBatches(objectPresence, async item => {
                    const key = `${kind}:${item.name}`
                    const base = { key, kind, name: item.name, differenceCount: 0, create: '', before: '', columns: '', after: '', drop: '' }
                    if (item.status === 'extra-target') return { ...base, status: item.status, drop: objectDropSQL(targetConnection?.engine ?? 'postgres', kind, targetSchema, item.name, targetNodes.get(item.name)?.detail) }
                    const originDDL = await GetObjectDDL(originConnId, kind, originSchema, item.name)
                    const mapped = remapObjectDDL(originDDL, targetConnection?.engine ?? 'postgres', originSchema, targetSchema)
                    const executable = !['routine', 'trigger'].includes(kind) || targetConnection?.engine === 'postgres'
                    if (item.status === 'missing-target') return {
                        ...base, status: item.status,
                        create: executable && kind === 'sequence' ? mapped : '',
                        after: executable && kind !== 'sequence' ? mapped : '',
                    }
                    const targetDDL = await GetObjectDDL(targetConnId, kind, targetSchema, item.name)
                    const changed = normalizeObjectDDL(originDDL, originSchema, item.name) !== normalizeObjectDDL(targetDDL, targetSchema, item.name)
                    if (!changed) return { ...base, status: 'match' as const }
                    return {
                        ...base, status: 'changed' as const, differenceCount: 1,
                        before: executable && (kind === 'sequence' || kind === 'trigger') ? objectDropSQL(targetConnection?.engine ?? 'postgres', kind, targetSchema, item.name, targetNodes.get(item.name)?.detail) : '',
                        create: executable && kind === 'sequence' ? mapped : '',
                        after: executable && kind !== 'sequence' ? mapped : '',
                    }
                })
            }))).flat()
            const output = [...extras, ...detailed, ...objectRows].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
            setRows(output)
            setSelected(new Set(output.filter(item => (item.status === 'changed' || item.status === 'missing-target') && (item.create || item.before || item.columns || item.after)).map(item => item.key)))
        } catch (error) {
            onError(String(error))
        } finally {
            setLoading(false)
        }
    }

    const selectedRows = rows.filter(row => selected.has(row.key))
    const sql = [
        selectedRows.map(row => row.before).filter(Boolean).join('\n'),
        selectedRows.map(row => row.create).filter(Boolean).join('\n'),
        selectedRows.map(row => row.columns).filter(Boolean).join('\n'),
        selectedRows.map(row => row.after).filter(Boolean).join('\n'),
        selectedRows.map(row => row.drop).filter(Boolean).join('\n'),
    ].filter(Boolean).join('\n')
    const sameEngine = originConnection?.engine === targetConnection?.engine
    const readOnly = !!targetConnection?.readOnly
    const apply = async () => {
        setBusy(true)
        try {
            await ApplyMigration(targetConnId, sql)
            await compare()
        } catch (error) {
            onError(String(error))
        } finally {
            setBusy(false)
            setConfirm(false)
        }
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
        <div className="modal schema-compare-dialog">
            <div className="schema-compare-title"><div><h2>Compare Schemas</h2><span>{originConnection?.name}: {originSchema}</span></div><button className="icon-btn" onClick={onClose} title="Close">x</button></div>
            <div className="schema-compare-toolbar">
                <span>Target</span>
                <select value={targetConnId} onChange={event => { const id = event.target.value; setTargetConnId(id); setTargetSchema(''); setRows([]) }}>
                    {targets.map(connection => <option value={connection.id} key={connection.id}>{connection.name}</option>)}
                </select>
                <select value={targetSchema} onChange={event => { setTargetSchema(event.target.value); setRows([]) }}>
                    <option value="">Select schema...</option>{targetSchemas.map(schema => <option key={schema}>{schema}</option>)}
                </select>
                <button onClick={() => void compare()} disabled={!targetSchema || loading}><RefreshCw size={13} /> Compare</button>
                <div className="tb-spacer" /><span>{rows.length ? `${rows.length} objects` : ''}</span>
            </div>
            {!sameEngine && <div className="migration-warning"><AlertTriangle size={14} /> Cross-engine comparison is preview-only.</div>}
            <div className="schema-compare-body">
                <div className="schema-table-list">
                    {rows.map(row => <label className={`schema-table-row ${row.status}`} key={row.key}>
                        <input type="checkbox" checked={selected.has(row.key)} disabled={row.status === 'match' || !(row.create || row.before || row.columns || row.after || row.drop)} onChange={event => setSelected(current => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(row.key)
                            else next.delete(row.key)
                            return next
                        })} />
                        <strong>{row.name}<small>{row.kind}</small></strong><span>{row.status.replace('-', ' ')}</span>
                        <small>{row.status === 'changed' ? row.before || row.create || row.after || row.columns ? `${row.differenceCount} differences` : 'manual migration' : row.status === 'match' ? <Check size={12} /> : row.status === 'missing-target' ? row.create || row.after ? 'create available' : 'manual migration' : row.drop ? 'drop opt-in' : 'manual migration'}</small>
                    </label>)}
                    {!loading && rows.length === 0 && <div className="comparison-empty">Choose a target schema and run comparison.</div>}
                    {loading && <div className="comparison-empty">Loading table metadata...</div>}
                </div>
                <div className="schema-compare-sql"><div className="migration-heading">Selected Migration <span>{selected.size} objects</span></div><textarea value={sql} readOnly spellCheck={false} /></div>
            </div>
            <div className="modal-buttons"><span>{readOnly ? 'Target is read-only.' : 'Extra-table drops are non-cascading and opt-in.'}</span><div className="spacer" /><button onClick={onClose} disabled={busy}>Close</button><button className="primary" disabled={busy || readOnly || !sameEngine || !sql} onClick={() => setConfirm(true)}>Apply Selected</button></div>
        </div>
        {confirm && <ConfirmDialog title="Synchronize selected objects?" message={`Apply the combined migration for ${selected.size} objects to ${targetSchema}?${selectedRows.some(row => row.status === 'extra-target') ? ' Selected extra objects will be permanently dropped.' : ''}`} confirmLabel="Apply Migration" danger={selectedRows.some(row => row.status === 'extra-target' || row.status === 'changed')} onCancel={() => setConfirm(false)} onConfirm={apply} />}
    </div>
}
