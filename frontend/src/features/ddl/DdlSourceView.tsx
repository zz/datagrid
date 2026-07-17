import { useCallback, useEffect, useState } from 'react'
import { Copy, GetObjectDDL, SaveTextFile } from '../../../wailsjs/go/api/App'
import { Clipboard, FileDown, RefreshCw, SquareTerminal } from 'lucide-react'
import { useApp } from '../../store'

export default function DdlSourceView({
    connId,
    kind,
    schema,
    name,
}: {
    connId: string
    kind: string
    schema: string
    name: string
}) {
    const openQueryTab = useApp(state => state.openQueryTab)
    const setError = useApp(state => state.setError)
    const [ddl, setDdl] = useState('')
    const [loading, setLoading] = useState(true)

    const load = useCallback(() => {
        setLoading(true)
        GetObjectDDL(connId, kind, schema, name)
            .then(setDdl)
            .catch(error => setError(String(error)))
            .finally(() => setLoading(false))
    }, [connId, kind, schema, name, setError])

    useEffect(load, [load])

    return (
        <div className="ddl-source-view">
            <div className="ddl-source-toolbar">
                <span>{schema}.{name}</span>
                <div className="tb-spacer" />
                <button onClick={load} disabled={loading} title="Refresh DDL"><RefreshCw size={13} /> Refresh</button>
                <button onClick={() => Copy(ddl)} disabled={!ddl} title="Copy DDL"><Clipboard size={13} /> Copy</button>
                <button onClick={() => SaveTextFile(`${name}.sql`, ddl)} disabled={!ddl} title="Save DDL"><FileDown size={13} /> Save</button>
                <button onClick={() => openQueryTab(connId, ddl, `${name} DDL`)} disabled={!ddl} title="Open DDL in a new console"><SquareTerminal size={13} /> Open in Console</button>
            </div>
            {loading ? <div className="grid-status">Loading DDL…</div> : <textarea value={ddl} readOnly spellCheck={false} aria-label={`DDL for ${schema}.${name}`} />}
        </div>
    )
}
