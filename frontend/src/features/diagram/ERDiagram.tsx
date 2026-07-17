import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Focus, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { OpenTable } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp } from '../../store'
import { DiagramPosition, diagramEdges, layoutTables } from './diagramModel'
import { loadVirtualForeignKeys } from './virtualForeignKeys'
import { qualifiedTable } from './dependencyModel'

const NODE_WIDTH = 250

function splitName(value: string) {
    const dot = value.indexOf('.')
    return dot < 0 ? { schema: '', table: value } : { schema: value.slice(0, dot), table: value.slice(dot + 1) }
}

export default function ERDiagram({ connId, current, onError }: {
    connId: string
    current: drivers.TableInfo
    onError: (message: string) => void
}) {
    const autocomplete = useApp(state => state.autocomplete[connId] ?? {})
    const currentName = qualifiedTable(current.schema, current.table)
    const [virtualKeys] = useState(() => loadVirtualForeignKeys(connId))
    const [initialNames] = useState(() => [currentName, ...(current.foreignKeys ?? []).map(key => qualifiedTable(key.referencedSchema || current.schema, key.referencedTable)), ...virtualKeys.flatMap(key => key.source === currentName ? [key.target] : key.target === currentName ? [key.source] : [])]
        .filter((name, index, names) => names.indexOf(name) === index))
    const [tables, setTables] = useState<Record<string, drivers.TableInfo>>({ [currentName]: current })
    const [positions, setPositions] = useState<Record<string, DiagramPosition>>(() => layoutTables(initialNames))
    const [candidate, setCandidate] = useState('')
    const [zoom, setZoom] = useState(1)
    const [loading, setLoading] = useState(false)
    const drag = useRef<{ name: string; startX: number; startY: number; origin: DiagramPosition } | null>(null)

    const load = async (names: string[]) => {
        const missing = names.filter(name => !tables[name])
        if (!missing.length) return
        setLoading(true)
        const results = await Promise.allSettled(missing.map(async name => {
            const { schema, table } = splitName(name)
            return [name, await OpenTable(connId, schema, table)] as const
        }))
        const loaded: Record<string, drivers.TableInfo> = {}
        results.forEach(result => {
            if (result.status === 'fulfilled') loaded[result.value[0]] = result.value[1]
            else onError(String(result.reason))
        })
        setTables(existing => ({ ...existing, ...loaded }))
        setLoading(false)
    }

    useEffect(() => {
        let active = true
        const seed = async () => {
            const related = initialNames.filter(name => name !== currentName)
            if (!related.length) return
            setLoading(true)
            const results = await Promise.allSettled(related.map(async name => {
                const { schema, table } = splitName(name)
                return [name, await OpenTable(connId, schema, table)] as const
            }))
            if (!active) return
            const loaded: Record<string, drivers.TableInfo> = {}
            results.forEach(result => {
                if (result.status === 'fulfilled') loaded[result.value[0]] = result.value[1]
                else onError(String(result.reason))
            })
            setTables(existing => ({ ...existing, ...loaded }))
            setLoading(false)
        }
        void seed()
        return () => { active = false }
    }, [connId, currentName, initialNames, onError])

    const names = Object.keys(tables)
    const edges = useMemo(() => diagramEdges(tables, virtualKeys), [tables, virtualKeys])
    const available = Object.keys(autocomplete).sort().filter(name => !tables[name])
    const nodeHeight = (name: string) => 42 + Math.min(tables[name]?.columns.length ?? 0, 9) * 24 + ((tables[name]?.columns.length ?? 0) > 9 ? 25 : 0)
    const resetLayout = () => setPositions(layoutTables(names))
    const addTable = async () => {
        if (!candidate) return
        setPositions(existing => ({ ...existing, [candidate]: layoutTables([...names, candidate])[candidate] }))
        await load([candidate])
        setCandidate('')
    }
    const removeTable = (name: string) => {
        if (name === currentName) return
        setTables(existing => Object.fromEntries(Object.entries(existing).filter(([key]) => key !== name)))
        setPositions(existing => Object.fromEntries(Object.entries(existing).filter(([key]) => key !== name)))
    }
    const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return
        const { name, startX, startY, origin } = drag.current
        setPositions(existing => ({ ...existing, [name]: {
            x: Math.max(8, origin.x + (event.clientX - startX) / zoom),
            y: Math.max(8, origin.y + (event.clientY - startY) / zoom),
        } }))
    }

    return (
        <div className="er-diagram">
            <div className="er-toolbar">
                <select value={candidate} onChange={event => setCandidate(event.target.value)} aria-label="Table to add">
                    <option value="">Add table...</option>
                    {available.map(name => <option key={name}>{name}</option>)}
                </select>
                <button onClick={() => void addTable()} disabled={!candidate || loading}><Plus size={13} /> Add</button>
                <span className="tb-sep" />
                <button className="icon-btn" onClick={() => setZoom(value => Math.max(0.5, value - 0.1))} title="Zoom out"><Minus size={14} /></button>
                <span className="er-zoom">{Math.round(zoom * 100)}%</span>
                <button className="icon-btn" onClick={() => setZoom(value => Math.min(1.6, value + 0.1))} title="Zoom in"><Plus size={14} /></button>
                <button className="icon-btn" onClick={() => setZoom(1)} title="Actual size"><Focus size={14} /></button>
                <button onClick={resetLayout}><RotateCcw size={13} /> Layout</button>
                <div className="tb-spacer" />
                <span className="er-summary">{names.length} tables, {edges.length} relationships{loading ? ' - loading' : ''}</span>
            </div>
            <div className="er-viewport" onPointerMove={pointerMove} onPointerUp={() => { drag.current = null }} onPointerLeave={() => { drag.current = null }}>
                <div className="er-world" style={{ transform: `scale(${zoom})` }}>
                    <svg className="er-edges" width="1400" height="1000" aria-hidden="true">
                        <defs><marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
                        {edges.map(edge => {
                            const source = positions[edge.source]
                            const target = positions[edge.target]
                            if (!source || !target) return null
                            const x1 = source.x + NODE_WIDTH
                            const y1 = source.y + nodeHeight(edge.source) / 2
                            const x2 = target.x
                            const y2 = target.y + nodeHeight(edge.target) / 2
                            const middle = (x1 + x2) / 2
                            return <g key={edge.id} className={edge.virtual ? 'virtual' : ''}><path d={`M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`} markerEnd="url(#er-arrow)" /><title>{edge.label}</title></g>
                        })}
                    </svg>
                    {names.map(name => {
                        const info = tables[name]
                        const position = positions[name] ?? { x: 36, y: 36 }
                        return <div className="er-node" key={name} style={{ left: position.x, top: position.y, width: NODE_WIDTH }}>
                            <div className="er-node-header" onPointerDown={event => {
                                event.currentTarget.setPointerCapture(event.pointerId)
                                drag.current = { name, startX: event.clientX, startY: event.clientY, origin: position }
                            }}>
                                <strong>{info.table}</strong><span>{info.schema}</span>
                                <button className="icon-btn" onPointerDown={event => event.stopPropagation()} onClick={() => removeTable(name)} disabled={name === currentName} title="Remove from diagram"><Trash2 size={12} /></button>
                            </div>
                            <div className="er-columns">
                                {info.columns.slice(0, 9).map(column => <div className="er-column" key={column.name}>
                                    <span className={info.primaryKey.includes(column.name) ? 'er-key' : ''}>{info.primaryKey.includes(column.name) ? 'PK' : ''}</span>
                                    <strong>{column.name}</strong><span>{column.typeName}</span>
                                </div>)}
                                {info.columns.length > 9 && <div className="er-more">+{info.columns.length - 9} more columns</div>}
                            </div>
                        </div>
                    })}
                </div>
            </div>
        </div>
    )
}
