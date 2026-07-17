import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Layers3, Plus, RotateCcw, Trash2 } from 'lucide-react'

export default function SchemaContextControl({ engine, available, value, fallback, onChange }: {
    engine: string
    available: string[]
    value: string[]
    fallback: string[]
    onChange: (schemas: string[]) => void
}) {
    const [open, setOpen] = useState(false)
    const [candidate, setCandidate] = useState('')
    const root = useRef<HTMLDivElement>(null)
    const choices = available.filter(schema => !value.includes(schema))

    useEffect(() => {
        if (!open) return
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent && event.key === 'Escape') setOpen(false)
            else if (event instanceof MouseEvent && !root.current?.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', close)
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
    }, [open])

    if (engine === 'mysql') return <label className="schema-context-select" title="Console default database"><Layers3 size={13} /><select value={value[0] ?? ''} onChange={event => onChange(event.target.value ? [event.target.value] : [])}><option value="">Connection default</option>{available.map(schema => <option key={schema}>{schema}</option>)}</select></label>

    const move = (index: number, delta: number) => {
        const next = [...value]
        const [item] = next.splice(index, 1)
        next.splice(index + delta, 0, item)
        onChange(next)
    }
    return <div className="schema-context-wrap" ref={root}>
        <button className={open ? 'active' : ''} onClick={() => setOpen(state => !state)} title="Console schema search path"><Layers3 size={13} /> {value[0] ?? 'Default'}{value.length > 1 ? ` +${value.length - 1}` : ''}</button>
        {open && <div className="schema-context-menu">
            <div className="schema-context-heading"><span>Schema Search Path</span><button className="icon-btn" onClick={() => onChange(fallback)} title="Reset search path"><RotateCcw size={12} /></button></div>
            <div className="schema-context-list">{value.map((schema, index) => <div className="schema-context-row" key={schema}><b>{index + 1}</b><span>{schema}</span><button className="icon-btn" disabled={index === 0} onClick={() => move(index, -1)} title="Move up"><ArrowUp size={11} /></button><button className="icon-btn" disabled={index === value.length - 1} onClick={() => move(index, 1)} title="Move down"><ArrowDown size={11} /></button><button className="icon-btn" onClick={() => onChange(value.filter(item => item !== schema))} title="Remove schema"><Trash2 size={11} /></button></div>)}</div>
            <div className="schema-context-add"><select value={candidate} onChange={event => setCandidate(event.target.value)}><option value="">Add schema...</option>{choices.map(schema => <option key={schema}>{schema}</option>)}</select><button className="icon-btn" disabled={!candidate} onClick={() => { if (candidate) onChange([...value, candidate]); setCandidate('') }} title="Add schema"><Plus size={13} /></button></div>
        </div>}
    </div>
}
