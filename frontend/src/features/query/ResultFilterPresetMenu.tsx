import { useEffect, useRef, useState } from 'react'
import { ListFilter, Save, Trash2, X } from 'lucide-react'
import type { ResultFilterPreset } from './resultFilterPresets'
import type { ResultFilter, ResultFilterExpression } from './resultProcessing'

export default function ResultFilterPresetMenu({ presets, filters, expression, onSave, onApply, onDelete, onClear }: {
    presets: ResultFilterPreset[]
    filters: ResultFilter[]
    expression: ResultFilterExpression | null
    onSave: (name: string) => void
    onApply: (preset: ResultFilterPreset) => void
    onDelete: (id: string) => void
    onClear: () => void
}) {
    const root = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    useEffect(() => {
        if (!open) return
        const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
        const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', closeOnEscape)
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', closeOnEscape) }
    }, [open])
    const save = () => {
        if (!name.trim() || filters.length === 0 && !expression) return
        onSave(name)
        setName('')
    }

    return <div ref={root} className="result-filter-preset-control">
        <button className={`icon-btn ${open ? 'active' : ''}`} onClick={() => setOpen(value => !value)} title="Saved result filters"><ListFilter size={13} /></button>
        {open && <div className="result-filter-preset-menu">
            <div className="result-filter-preset-heading"><ListFilter size={12} /><strong>Filter presets</strong>{(filters.length > 0 || expression) && <button className="icon-btn" onClick={onClear} title="Clear active filters"><X size={11} /></button>}</div>
            <div className="result-filter-preset-save"><input autoFocus placeholder="Preset name" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => event.key === 'Enter' && save()} /><button className="icon-btn" disabled={!name.trim() || filters.length === 0 && !expression} onClick={save} title="Save active filters"><Save size={12} /></button></div>
            <div className="result-filter-preset-list">{presets.map(preset => { const count = preset.filters.length + (preset.expression?.groups.reduce((total, group) => total + group.filters.length, 0) ?? 0); return <div key={preset.id}><button onClick={() => { onApply(preset); setOpen(false) }}><span>{preset.name}</span><small>{count} {count === 1 ? 'rule' : 'rules'}</small></button><button className="icon-btn" onClick={() => onDelete(preset.id)} title={`Delete ${preset.name}`}><Trash2 size={11} /></button></div> })}{presets.length === 0 && <p>No saved presets.</p>}</div>
        </div>}
    </div>
}
