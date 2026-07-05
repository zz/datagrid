import { useMemo, useState } from 'react'
import { useApp } from '../../store'

interface Entry {
    connId: string
    connName: string
    schema: string
    table: string
}

// GoToPalette is a quick-open (⌘P) for jumping to any table across all
// connected databases — DataGrip-style navigation. It uses the autocomplete
// map ("schema.table" → columns) already fetched on connect.
export default function GoToPalette({ onClose }: { onClose: () => void }) {
    const connections = useApp(s => s.connections)
    const autocomplete = useApp(s => s.autocomplete)
    const connected = useApp(s => s.connected)
    const openTableTab = useApp(s => s.openTableTab)
    const [q, setQ] = useState('')
    const [sel, setSel] = useState(0)

    const all = useMemo(() => {
        const out: Entry[] = []
        for (const c of connections) {
            if (!connected[c.id]) continue
            const map = autocomplete[c.id] ?? {}
            for (const key of Object.keys(map)) {
                const dot = key.indexOf('.')
                const schema = dot >= 0 ? key.slice(0, dot) : ''
                const table = dot >= 0 ? key.slice(dot + 1) : key
                out.push({ connId: c.id, connName: c.name, schema, table })
            }
        }
        return out
    }, [connections, autocomplete, connected])

    const matches = useMemo(() => {
        const needle = q.trim().toLowerCase()
        const list = needle === '' ? all : all.filter(e => `${e.schema}.${e.table}`.toLowerCase().includes(needle))
        return list.slice(0, 50)
    }, [all, q])

    const choose = (e: Entry) => {
        openTableTab(e.connId, e.schema, e.table)
        onClose()
    }

    const onKey = (ev: React.KeyboardEvent) => {
        if (ev.key === 'ArrowDown') {
            ev.preventDefault()
            setSel(s => Math.min(s + 1, matches.length - 1))
        } else if (ev.key === 'ArrowUp') {
            ev.preventDefault()
            setSel(s => Math.max(s - 1, 0))
        } else if (ev.key === 'Enter') {
            ev.preventDefault()
            if (matches[sel]) choose(matches[sel])
        } else if (ev.key === 'Escape') {
            onClose()
        }
    }

    return (
        <div className="modal-backdrop palette-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="palette">
                <input
                    className="palette-input"
                    placeholder="Go to table…"
                    value={q}
                    autoFocus
                    onChange={e => {
                        setQ(e.target.value)
                        setSel(0)
                    }}
                    onKeyDown={onKey}
                />
                <div className="palette-list">
                    {all.length === 0 && <div className="palette-empty">Connect to a database first.</div>}
                    {all.length > 0 && matches.length === 0 && <div className="palette-empty">No matches.</div>}
                    {matches.map((e, i) => (
                        <div
                            key={`${e.connId}.${e.schema}.${e.table}`}
                            className={`palette-item ${i === sel ? 'selected' : ''}`}
                            onMouseEnter={() => setSel(i)}
                            onClick={() => choose(e)}
                        >
                            <span className="palette-table">
                                {e.schema ? `${e.schema}.` : ''}
                                {e.table}
                            </span>
                            <span className="palette-conn">{e.connName}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
