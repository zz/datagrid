import { useMemo, useState } from 'react'
import { Braces, Columns3, FileSearch, LoaderCircle, Rows3, Table2 } from 'lucide-react'
import { GetObjectDDL, Introspect, SearchDatabaseData } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp } from '../../store'
import { DatabaseSearchMatch, definitionMatch, metadataMatches, SearchObject } from './databaseSearch'

const SEARCH_KINDS = ['table', 'view', 'routine', 'sequence', 'trigger']

export default function DatabaseSearchDialog({ initialConnId, onClose }: { initialConnId?: string; onClose: () => void }) {
    const connections = useApp(state => state.connections)
    const connected = useApp(state => state.connected)
    const autocomplete = useApp(state => state.autocomplete)
    const openTableTab = useApp(state => state.openTableTab)
    const openQueryTab = useApp(state => state.openQueryTab)
    const openTableWithFilter = useApp(state => state.openTableWithFilter)
    const setError = useApp(state => state.setError)
    const available = connections.filter(connection => connected[connection.id] && connection.engine !== 'redis')
    const [connId, setConnId] = useState(initialConnId && connected[initialConnId] ? initialConnId : 'all')
    const [query, setQuery] = useState('')
    const [mode, setMode] = useState<'objects' | 'data'>('objects')
    const [scanDefinitions, setScanDefinitions] = useState(true)
    const [matches, setMatches] = useState<DatabaseSearchMatch[]>([])
    const [searching, setSearching] = useState(false)
    const [scanned, setScanned] = useState(0)
    const [limited, setLimited] = useState(false)

    const cachedObjects = useMemo(() => available.filter(connection => connId === 'all' || connection.id === connId).flatMap(connection =>
        Object.entries(autocomplete[connection.id] ?? {}).map(([qualified, columns]) => {
            const separator = qualified.indexOf('.')
            return { connId: connection.id, connName: connection.name, schema: separator < 0 ? '' : qualified.slice(0, separator), kind: 'table', name: separator < 0 ? qualified : qualified.slice(separator + 1), columns } satisfies SearchObject
        })), [autocomplete, available, connId])

    const search = async () => {
        const needle = query.trim()
        if (needle.length < 2) return
        setSearching(true); setScanned(0); setLimited(false)
        if (mode === 'data') {
            setMatches([])
            try {
                const selected = available.filter(item => connId === 'all' || item.id === connId)
                const found: DatabaseSearchMatch[] = []
                let anyLimited = false
                for (const connection of selected) {
                    const response = await SearchDatabaseData(connection.id, drivers.DataSearchRequest.createFrom({ query: needle, maxTables: 50, maxResults: Math.max(1, 200 - found.length) }))
                    found.push(...(response.matches ?? []).map(match => ({ connId: connection.id, connName: connection.name, schema: match.schema, kind: 'table', name: match.table, source: 'data' as const, detail: match.value, column: match.column })))
                    setScanned(current => current + response.tablesScanned)
                    anyLimited ||= response.limited
                    setMatches([...found])
                    if (found.length >= 200) { anyLimited = true; break }
                }
                setLimited(anyLimited)
            } catch (error) { setError(String(error)) } finally { setSearching(false) }
            return
        }
        const immediate = metadataMatches(cachedObjects, needle)
        setMatches(immediate)
        if (!scanDefinitions) { setSearching(false); return }
        try {
            const objects: SearchObject[] = []
            for (const connection of available.filter(item => connId === 'all' || item.id === connId)) {
                const schemas = await Introspect(connection.id, drivers.IntrospectScope.createFrom({}))
                for (const schemaNode of schemas.nodes ?? []) {
                    for (const kind of SEARCH_KINDS) {
                        const tree = await Introspect(connection.id, drivers.IntrospectScope.createFrom({ schema: schemaNode.name, category: kind }))
                        for (const node of tree.nodes ?? []) objects.push({ connId: connection.id, connName: connection.name, schema: schemaNode.name, kind: node.kind || kind, name: node.name })
                    }
                }
            }
            const candidates = objects.slice(0, 500)
            setLimited(objects.length > candidates.length)
            const definitionMatches: DatabaseSearchMatch[] = []
            for (let offset = 0; offset < candidates.length; offset += 8) {
                const batch = candidates.slice(offset, offset + 8)
                const found = await Promise.all(batch.map(async object => {
                    try { return definitionMatch(object, needle, await GetObjectDDL(object.connId, object.kind, object.schema, object.name)) }
                    catch { return null }
                }))
                definitionMatches.push(...found.filter((match): match is DatabaseSearchMatch => !!match))
                setScanned(Math.min(offset + batch.length, candidates.length))
                setMatches([...immediate, ...definitionMatches])
            }
        } catch (error) { setError(String(error)) } finally { setSearching(false) }
    }

    const choose = async (match: DatabaseSearchMatch) => {
        if (match.source === 'data' && match.column) {
            await openTableWithFilter(match.connId, match.schema, match.name, match.column, query.trim(), 'contains')
            onClose()
            return
        }
        if (match.kind === 'table' || match.kind === 'view') {
            await openTableTab(match.connId, match.schema, match.name, match.kind)
        } else {
            const ddl = match.ddl ?? await GetObjectDDL(match.connId, match.kind, match.schema, match.name)
            openQueryTab(match.connId, ddl, `${match.name} DDL`)
        }
        onClose()
    }
    const icon = (match: DatabaseSearchMatch) => match.source === 'column' ? <Columns3 size={13} /> : match.source === 'definition' ? <Braces size={13} /> : match.source === 'data' ? <Rows3 size={13} /> : <Table2 size={13} />

    return <div className="modal-backdrop search-dialog-backdrop" onMouseDown={event => event.target === event.currentTarget && !searching && onClose()}>
        <div className="modal database-search-dialog">
            <div className="database-search-title"><FileSearch size={17} /><div><h2>Search Database</h2><span>Objects, usages, columns, and stored values</span></div><div className="database-search-mode"><button className={mode === 'objects' ? 'active' : ''} onClick={() => { setMode('objects'); setMatches([]) }}>Objects</button><button className={mode === 'data' ? 'active' : ''} onClick={() => { setMode('data'); setMatches([]) }}>Data</button></div></div>
            <div className="database-search-controls"><select value={connId} onChange={event => setConnId(event.target.value)}><option value="all">All connected databases</option>{available.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select><input autoFocus value={query} placeholder="Object, column, or SQL text" onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void search()} /><button className="primary" disabled={searching || query.trim().length < 2} onClick={() => void search()}>{searching ? <LoaderCircle className="spin" size={13} /> : <FileSearch size={13} />} Search</button></div>
            <div className="database-search-options">{mode === 'objects' ? <label><input type="checkbox" checked={scanDefinitions} onChange={event => setScanDefinitions(event.target.checked)} /> Search definitions and usages</label> : <span>Text-compatible columns only; up to 50 tables and 200 matches per search.</span>}<span>{searching ? `Scanning ${scanned.toLocaleString()} ${mode === 'data' ? 'tables' : 'definitions'}...` : matches.length ? `${matches.length.toLocaleString()} matches` : 'Enter at least 2 characters'}</span></div>
            <div className="database-search-results">{matches.map((match, index) => <button key={`${match.connId}-${match.schema}-${match.kind}-${match.name}-${match.source}-${index}`} onClick={() => void choose(match)}><span className={`search-kind ${match.source}`}>{icon(match)}</span><span className="search-result-main"><strong>{match.schema}.{match.name}{match.column ? ` / ${match.column}` : ''}</strong><small>{match.detail}</small></span><span className="search-result-meta">{match.source}<small>{match.connName}</small></span></button>)}{!searching && query.trim().length >= 2 && matches.length === 0 && <div className="database-search-empty">No matches found.</div>}</div>
            {limited && <div className="migration-warning">Search reached its safety limit. Narrow the connection scope or search text for more complete results.</div>}
            <div className="modal-buttons"><span>{mode === 'objects' ? 'Definition matches reveal views, routines, and triggers that reference a searched object.' : 'Data searches are read-only and use literal, parameter-bound substring matching.'}</span><div className="spacer" /><button onClick={onClose} disabled={searching}>Close</button></div>
        </div>
    </div>
}
