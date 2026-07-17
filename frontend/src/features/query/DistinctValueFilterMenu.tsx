import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Search, X } from 'lucide-react'
import type { DistinctColumnValue, ResultFilter } from './resultProcessing'

const valueKey = (value: Pick<DistinctColumnValue, 'value' | 'isNull'>) => value.isNull ? 'null' : `value:${value.value}`

export default function DistinctValueFilterMenu({ x, y, column, values, activeFilters, loading = false, limited = false, onSearchChange, onApply, onClear, onClose }: {
    x: number
    y: number
    column: string
    values: DistinctColumnValue[]
    activeFilters: ResultFilter[]
    loading?: boolean
    limited?: boolean
    onSearchChange?: (search: string) => void
    onApply: (values: DistinctColumnValue[]) => void
    onClear: () => void
    onClose: () => void
}) {
    const root = useRef<HTMLDivElement>(null)
    const [search, setSearch] = useState('')
    const [selected, setSelected] = useState(() => {
        const keys = new Set<string>()
        activeFilters.forEach(filter => {
            if (filter.op === 'is null' || filter.op === 'in' && filter.includeNull) keys.add('null')
            if (filter.op === '=') keys.add(`value:${filter.value}`)
            if (filter.op === 'in') filter.values?.forEach(value => keys.add(`value:${value}`))
        })
        return keys
    })
    useEffect(() => {
        const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) onClose() }
        const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', closeOnEscape)
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', closeOnEscape) }
    }, [onClose])
    useEffect(() => {
        if (!onSearchChange) return
        const timer = window.setTimeout(() => onSearchChange(search), 250)
        return () => window.clearTimeout(timer)
    }, [onSearchChange, search])
    const shown = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return (needle ? values.filter(value => value.isNull ? 'null'.includes(needle) : value.value.toLowerCase().includes(needle)) : values).slice(0, 500)
    }, [search, values])
    const toggle = (value: DistinctColumnValue) => setSelected(current => {
        const next = new Set(current)
        const key = valueKey(value)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
    })
    const selectedValues = [...selected].map(key => {
        const isNull = key === 'null'
        const value = isNull ? '' : key.slice('value:'.length)
        return values.find(item => item.isNull === isNull && item.value === value) ?? { value, isNull, count: 0 }
    })

    return <div ref={root} className="distinct-filter-menu" style={{ left: Math.max(6, Math.min(x, window.innerWidth - 292)), top: Math.max(6, Math.min(y, window.innerHeight - 420)) }}>
        <div className="distinct-filter-title"><strong>{column}</strong>{loading ? <LoaderCircle className="distinct-filter-loading" size={12} /> : <span>{values.length.toLocaleString()} values</span>}{activeFilters.length > 0 && <button className="icon-btn" onClick={onClear} title="Clear column filters"><X size={11} /></button>}</div>
        <label className="distinct-filter-search"><Search size={12} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="distinct-filter-bulk"><button onClick={() => setSelected(current => new Set([...current, ...shown.map(valueKey)]))}>All shown</button><button onClick={() => setSelected(new Set())}>None</button><span>{selected.size.toLocaleString()} selected</span></div>
        <div className="distinct-filter-values">{shown.map(value => <label key={valueKey(value)} className={selected.has(valueKey(value)) ? 'active' : ''}><input type="checkbox" checked={selected.has(valueKey(value))} onChange={() => toggle(value)} /><span>{value.isNull ? 'NULL' : value.value || '(empty)'}</span><b>{value.count.toLocaleString()}</b></label>)}{shown.length === 0 && <div>No matching values.</div>}</div>
        {(limited || values.length > 500) && <div className="distinct-filter-limit">First 500 {search ? 'matches' : 'values'}</div>}
        <div className="distinct-filter-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={selectedValues.length === 0} onClick={() => onApply(selectedValues)}>Apply</button></div>
    </div>
}
