import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ExternalLink, Link2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { OpenTable } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp } from '../../store'
import { DependencyDirection, dependencyEdges, dependencyPaths, impactLevel, qualifiedTable } from './dependencyModel'
import VirtualForeignKeyDialog from './VirtualForeignKeyDialog'
import { deleteVirtualForeignKey, loadVirtualForeignKeys, VirtualForeignKey } from './virtualForeignKeys'

const CONCURRENCY = 6

function splitName(value: string) {
    const dot = value.indexOf('.')
    return dot < 0 ? { schema: '', table: value } : { schema: value.slice(0, dot), table: value.slice(dot + 1) }
}

async function loadTableMetadata(connId: string, names: string[], current: drivers.TableInfo) {
    const currentName = qualifiedTable(current.schema, current.table)
    const tables: Record<string, drivers.TableInfo> = { [currentName]: current }
    const failures: string[] = []
    let cursor = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, names.length) }, async () => {
        while (cursor < names.length) {
            const name = names[cursor++]
            if (name === currentName) continue
            const { schema, table } = splitName(name)
            try {
                tables[name] = await OpenTable(connId, schema, table)
            } catch {
                failures.push(name)
            }
        }
    })
    await Promise.all(workers)
    return { tables, failures }
}

export default function DependencyAnalysis({ connId, current, onError }: {
    connId: string
    current: drivers.TableInfo
    onError: (message: string) => void
}) {
    const autocomplete = useApp(state => state.autocomplete[connId] ?? {})
    const openTableTab = useApp(state => state.openTableTab)
    const [tables, setTables] = useState<Record<string, drivers.TableInfo>>({})
    const [failures, setFailures] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [reload, setReload] = useState(0)
    const [direction, setDirection] = useState<DependencyDirection>('incoming')
    const [transitive, setTransitive] = useState(true)
    const [query, setQuery] = useState('')
    const [virtualKeys, setVirtualKeys] = useState<VirtualForeignKey[]>(() => loadVirtualForeignKeys(connId))
    const [virtualEditorOpen, setVirtualEditorOpen] = useState(false)
    const currentName = qualifiedTable(current.schema, current.table)
    const names = useMemo(() => Object.keys(autocomplete).sort(), [autocomplete])

    useEffect(() => {
        let active = true
        setLoading(true)
        setFailures([])
        void loadTableMetadata(connId, names, current).then(result => {
            if (!active) return
            setTables(result.tables)
            setFailures(result.failures)
        }).catch(error => {
            if (active) onError(String(error))
        }).finally(() => {
            if (active) setLoading(false)
        })
        return () => { active = false }
    }, [connId, current, names, onError, reload])

    const edges = useMemo(() => dependencyEdges(tables, virtualKeys), [tables, virtualKeys])
    const paths = useMemo(() => dependencyPaths(edges, currentName, direction), [currentName, direction, edges])
    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return paths.filter(path => (transitive || path.depth === 1) && (!needle || `${path.table} ${path.edge.constraint} ${path.path.join(' ')}`.toLowerCase().includes(needle)))
    }, [paths, query, transitive])
    const directCount = paths.filter(path => path.depth === 1).length
    const relatedVirtualKeys = virtualKeys.filter(key => key.source === currentName || key.target === currentName)
    const action = direction === 'incoming' ? 'Dropping or changing this table can affect these dependents.' : 'This table relies on these referenced objects.'

    return <div className="dependency-analysis">
        <div className="dependency-toolbar">
            <div className="dependency-modes" role="group" aria-label="Dependency direction">
                <button className={direction === 'incoming' ? 'active' : ''} onClick={() => setDirection('incoming')}><ArrowDownToLine size={13} /> Referenced by</button>
                <button className={direction === 'outgoing' ? 'active' : ''} onClick={() => setDirection('outgoing')}><ArrowUpFromLine size={13} /> Depends on</button>
            </div>
            <label className="dependency-transitive"><input type="checkbox" checked={transitive} onChange={event => setTransitive(event.target.checked)} /> Transitive</label>
            <label className="dependency-search"><Search size={13} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter dependencies" /></label>
            <div className="tb-spacer" />
            <button onClick={() => setVirtualEditorOpen(true)}><Link2 size={13} /> Virtual FK</button>
            <button className="icon-btn" onClick={() => setReload(value => value + 1)} disabled={loading} title="Reload dependency metadata"><RefreshCw size={14} /></button>
        </div>
        <div className="dependency-summary">
            <span><strong>{currentName}</strong> {action}</span>
            <span>{directCount} direct, {Math.max(0, paths.length - directCount)} transitive{loading ? ` - scanning ${names.length} objects` : ''}</span>
        </div>
        {failures.length > 0 && <div className="dependency-warning"><AlertTriangle size={13} /> {failures.length} object{failures.length === 1 ? '' : 's'} could not be inspected. Results may be incomplete.</div>}
        {relatedVirtualKeys.length > 0 && <div className="dependency-virtual-list"><strong>Virtual relationships</strong>{relatedVirtualKeys.map(key => <span key={key.id}><code>{key.name}</code><small>{key.source} -&gt; {key.target}</small><button className="icon-btn" onClick={() => { deleteVirtualForeignKey(key.id); setVirtualKeys(keys => keys.filter(item => item.id !== key.id)) }} title="Delete virtual relationship"><Trash2 size={12} /></button></span>)}</div>}
        <div className="dependency-table-wrap">
            <table className="dependency-table">
                <thead><tr><th>Risk</th><th>Object</th><th>Depth</th><th>Constraint</th><th>Columns</th><th>Actions</th><th /></tr></thead>
                <tbody>{visible.map(path => {
                    const level = impactLevel(path)
                    const columns = `${path.edge.sourceColumns.join(', ')} -> ${path.edge.targetColumns.join(', ')}`
                    const actions = [path.edge.onUpdate && `UPDATE ${path.edge.onUpdate}`, path.edge.onDelete && `DELETE ${path.edge.onDelete}`].filter(Boolean).join(' / ')
                    const target = splitName(path.table)
                    return <tr key={`${path.edge.id}:${path.table}:${path.depth}`}>
                        <td><span className={`dependency-risk ${level}`}>{direction === 'incoming' ? level : path.depth === 1 ? 'direct' : 'indirect'}</span></td>
                        <td><button className="dependency-object" onClick={() => void openTableTab(connId, target.schema, target.table)} title={path.path.join(' -> ')}>{path.table}</button></td>
                        <td>{path.depth}</td>
                        <td><code>{path.edge.constraint || 'unnamed'}</code>{path.edge.virtualKeyId && <span className="dependency-virtual">virtual</span>}</td>
                        <td title={columns}>{columns}</td>
                        <td>{path.edge.virtualKeyId ? 'Local metadata' : actions || 'Default rules'}</td>
                        <td><span className="dependency-actions"><button className="icon-btn" onClick={() => void openTableTab(connId, target.schema, target.table)} title="Open table"><ExternalLink size={13} /></button>{path.edge.virtualKeyId && <button className="icon-btn" onClick={() => {
                            deleteVirtualForeignKey(path.edge.virtualKeyId!)
                            setVirtualKeys(keys => keys.filter(key => key.id !== path.edge.virtualKeyId))
                        }} title="Delete virtual relationship"><Trash2 size={13} /></button>}</span></td>
                    </tr>
                })}</tbody>
            </table>
            {!loading && visible.length === 0 && <div className="dependency-empty">{query ? 'No dependencies match the filter.' : direction === 'incoming' ? 'No tables reference this table.' : 'This table has no foreign-key dependencies.'}</div>}
            {loading && Object.keys(tables).length === 0 && <div className="dependency-empty">Inspecting table relationships...</div>}
        </div>
        {virtualEditorOpen && <VirtualForeignKeyDialog connId={connId} currentName={currentName} autocomplete={autocomplete} onClose={() => setVirtualEditorOpen(false)} onSave={key => { setVirtualKeys(keys => [...keys, key]); setVirtualEditorOpen(false) }} />}
    </div>
}
