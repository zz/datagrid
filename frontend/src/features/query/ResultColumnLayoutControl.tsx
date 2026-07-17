import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Columns3, Eye, EyeOff, Pin, PinOff, RotateCcw, Save, Search, Trash2 } from 'lucide-react'
import type { Column } from '../../ipc/types'
import { moveResultColumnId, resultVisibleColumnIndexes, setResultColumnsPinned, setResultColumnsVisible, toggleResultColumnPinned, type ResultColumnLayout } from './resultColumnLayout'
import { createResultColumnLayoutPreset, loadResultColumnLayoutPresets, saveResultColumnLayoutPresets, type ResultColumnLayoutPreset } from './resultColumnLayoutPresets'

export default function ResultColumnLayoutControl({ columns, columnIds, layout, presetContextKey, onChange, onOpen, onReset }: {
    columns: Column[]
    columnIds: string[]
    layout: ResultColumnLayout
    presetContextKey: string
    onChange: (layout: ResultColumnLayout) => void
    onOpen?: () => void
    onReset?: () => void
}) {
    const root = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const [search, setSearch] = useState('')
    const [presets, setPresets] = useState<ResultColumnLayoutPreset[]>([])
    const hidden = new Set(layout.hidden)
    const visibleIndexes = resultVisibleColumnIndexes(layout, columnIds)
    const visibleIds = visibleIndexes.map(index => columnIds[index])
    const needle = search.trim().toLowerCase()
    const matchedIds = layout.order.filter(id => {
        const sourceIndex = columnIds.indexOf(id)
        return !needle || (columns[sourceIndex]?.name ?? id).toLowerCase().includes(needle)
    })
    const matchedVisible = matchedIds.filter(id => !hidden.has(id))
    const matchedPinned = matchedIds.filter(id => visibleIds.indexOf(id) >= 0 && visibleIds.indexOf(id) < layout.frozen)
    useEffect(() => setPresets(typeof window === 'undefined' ? [] : loadResultColumnLayoutPresets(presetContextKey)), [presetContextKey])
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
    const toggle = () => {
        setOpen(current => {
            if (!current) onOpen?.()
            return !current
        })
    }
    const updatePresets = (next: ResultColumnLayoutPreset[]) => {
        setPresets(next)
        if (typeof window !== 'undefined') saveResultColumnLayoutPresets(presetContextKey, next)
    }
    const savePreset = () => {
        if (!name.trim()) return
        updatePresets([...presets, createResultColumnLayoutPreset(name, layout)])
        setName('')
    }

    return <div className="result-layout-control" ref={root}>
        <button className={`icon-btn ${open ? 'active' : ''}`} onClick={toggle} title="Result column layout"><Columns3 size={13} /></button>
        {open && <div className="result-layout-menu">
            <div className="result-layout-heading"><Columns3 size={12} /><span>Columns</span><button className="icon-btn" onClick={() => { onChange({ order: columnIds, hidden: [], frozen: 0 }); onReset?.() }} title="Reset column layout"><RotateCcw size={11} /></button></div>
            <div className="result-layout-preset-save"><input placeholder="Layout name" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => event.key === 'Enter' && savePreset()} /><button className="icon-btn" disabled={!name.trim()} onClick={savePreset} title="Save current layout"><Save size={11} /></button></div>
            <div className="result-layout-presets">{presets.map(preset => <div key={preset.id}><button onClick={() => { onChange(preset.layout); setOpen(false) }}><span>{preset.name}</span><small>{preset.layout.hidden.length} hidden · {preset.layout.frozen} pinned</small></button><button className="icon-btn" onClick={() => updatePresets(presets.filter(item => item.id !== preset.id))} title={`Delete ${preset.name}`}><Trash2 size={11} /></button></div>)}{presets.length === 0 && <p>No saved layouts.</p>}</div>
            <div className="result-layout-search"><Search size={11} /><input placeholder="Search columns" value={search} onChange={event => setSearch(event.target.value)} /><span>{matchedIds.length}</span></div>
            <div className="result-layout-bulk" role="group" aria-label="Bulk column layout actions">
                <button className="icon-btn" onClick={() => onChange(setResultColumnsVisible(layout, matchedIds, true))} disabled={!matchedIds.some(id => hidden.has(id))} title="Show matching columns"><Eye size={12} /></button>
                <button className="icon-btn" onClick={() => onChange(setResultColumnsVisible(layout, matchedIds, false))} disabled={!matchedVisible.length || visibleIds.length === 1} title="Hide matching columns"><EyeOff size={12} /></button>
                <button className="icon-btn" onClick={() => onChange(setResultColumnsPinned(layout, matchedIds, true))} disabled={!matchedVisible.some(id => !matchedPinned.includes(id))} title="Pin matching columns"><Pin size={12} /></button>
                <button className="icon-btn" onClick={() => onChange(setResultColumnsPinned(layout, matchedIds, false))} disabled={!matchedPinned.length} title="Unpin matching columns"><PinOff size={12} /></button>
            </div>
            <div className="result-layout-columns">{matchedIds.map(id => {
                const sourceIndex = columnIds.indexOf(id)
                const isHidden = hidden.has(id)
                const cohort = layout.order.filter(column => hidden.has(column) === isHidden)
                const cohortIndex = cohort.indexOf(id)
                const visibleIndex = visibleIds.indexOf(id)
                const pinned = visibleIndex >= 0 && visibleIndex < layout.frozen
                return <div className="result-layout-row" key={id}>
                    <input type="checkbox" checked={!isHidden} disabled={!isHidden && visibleIndexes.length === 1} onChange={event => onChange({ ...layout, hidden: event.target.checked ? layout.hidden.filter(column => column !== id) : [...layout.hidden, id] })} aria-label={`Show ${columns[sourceIndex]?.name ?? id}`} />
                    <span title={columns[sourceIndex]?.name ?? id}>{columns[sourceIndex]?.name ?? id}</span>
                    <button className="icon-btn" onClick={() => onChange(moveResultColumnId(layout, id, -1))} disabled={cohortIndex <= 0} title="Move column earlier"><ArrowUp size={11} /></button>
                    <button className="icon-btn" onClick={() => onChange(moveResultColumnId(layout, id, 1))} disabled={cohortIndex < 0 || cohortIndex >= cohort.length - 1} title="Move column later"><ArrowDown size={11} /></button>
                    <button className={`icon-btn ${pinned ? 'active' : ''}`} onClick={() => onChange(toggleResultColumnPinned(layout, id))} disabled={isHidden} title={pinned ? 'Unpin column' : 'Pin column'}>{pinned ? <PinOff size={11} /> : <Pin size={11} />}</button>
                </div>
            })}{matchedIds.length === 0 && <p className="result-layout-empty">No matching columns.</p>}</div>
            <label className="result-layout-frozen"><Pin size={11} /><span>Pinned leading columns</span><input type="number" min={0} max={visibleIndexes.length} value={layout.frozen} onChange={event => onChange({ ...layout, frozen: Number(event.target.value) })} /></label>
        </div>}
    </div>
}
