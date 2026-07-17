import { useEffect, useMemo, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, ChevronLeft, ChevronRight, Database, ListTree, X } from 'lucide-react'
import type { Column } from '../../ipc/types'
import ResultColumnLayoutControl from './ResultColumnLayoutControl'
import AdvancedResultFilterDialog from './AdvancedResultFilterDialog'
import ResultFilterPresetMenu from './ResultFilterPresetMenu'
import { createResultFilterPreset, loadResultFilterPresets, type ResultFilterPreset, saveResultFilterPresets } from './resultFilterPresets'
import { moveResultSort, resultViewSorts, withResultSorts, type ResultFilter, type ResultFilterExpression, type ResultViewState } from './resultProcessing'
import type { ResultColumnLayout } from './resultColumnLayout'

const FILTER_OPS = ['contains', '=', '!=', '<', '>', '<=', '>=', 'starts', 'is null', 'is not null']

const cloneExpression = (expression: ResultFilterExpression | null | undefined): ResultFilterExpression | null => expression
    ? { ...expression, groups: expression.groups.map(group => ({ ...group, filters: group.filters.map(filter => ({ ...filter, values: filter.values ? [...filter.values] : undefined })) })) }
    : null

export default function ResultViewControls({ columns, columnIds, columnLayout, rows, view, presetContextKey, engine, serverActive = false, serverBusy = false, onChange, onColumnLayoutChange }: {
    columns: Column[]
    columnIds: string[]
    columnLayout: ResultColumnLayout
    rows: number
    view: ResultViewState
    presetContextKey: string
    engine: string
    serverActive?: boolean
    serverBusy?: boolean
    onChange: (view: ResultViewState) => void
    onColumnLayoutChange: (layout: ResultColumnLayout) => void
}) {
    const [filterColumn, setFilterColumn] = useState(0)
    const [filterOp, setFilterOp] = useState('contains')
    const [filterValue, setFilterValue] = useState('')
    const [sortColumn, setSortColumn] = useState(0)
    const [presets, setPresets] = useState<ResultFilterPreset[]>([])
    const [showAdvanced, setShowAdvanced] = useState(false)
    useEffect(() => setPresets(typeof window === 'undefined' ? [] : loadResultFilterPresets(presetContextKey)), [presetContextKey])
    useEffect(() => setFilterColumn(column => Math.min(column, Math.max(0, columns.length - 1))), [columns.length])
    useEffect(() => setSortColumn(column => Math.min(column, Math.max(0, columns.length - 1))), [columns.length])

    const expression = view.expression ?? null
    const sorts = useMemo(() => resultViewSorts(view), [view])
    const selectedSortIndex = sorts.findIndex(sort => sort.column === sortColumn)
    const selectedSort = sorts[selectedSortIndex]
    const advancedFilterCount = useMemo(() => expression?.groups.reduce((total, group) => total + group.filters.length, 0) ?? 0, [expression])
    const updatePresets = (next: ResultFilterPreset[]) => {
        setPresets(next)
        if (typeof window !== 'undefined') saveResultFilterPresets(presetContextKey, next)
    }
    const updateFilters = (filters: ResultFilter[], nextExpression = expression) => onChange({ ...view, filters, expression: nextExpression })
    const updateSorts = (next: typeof sorts) => onChange(withResultSorts(view, next))
    const setSortDirection = (descending: boolean) => updateSorts(selectedSort
        ? sorts.map(sort => sort.column === sortColumn ? { ...sort, descending } : sort)
        : [...sorts, { column: sortColumn, descending }])
    const addFilter = () => {
        if (!columns.length || !filterOp.includes('null') && !filterValue) return
        updateFilters([...view.filters, { column: filterColumn, op: filterOp, value: filterValue }])
        setFilterValue('')
    }
    const filterLabel = (filter: ResultFilter) => {
        if (filter.op !== 'in') return `${columns[filter.column]?.name} ${filter.op}${filter.value ? ` ${filter.value}` : ''}`
        const values = [...(filter.values ?? []), ...(filter.includeNull ? ['NULL'] : [])]
        return `${columns[filter.column]?.name} in ${values.slice(0, 3).join(', ')}${values.length > 3 ? ` +${values.length - 3}` : ''}`
    }

    return <div className="result-mode-filterbar">
        <input className="grid-search" placeholder="Search results…" value={view.search} onChange={event => onChange({ ...view, search: event.target.value })} />
        {view.search && <span className="grid-search-count">{rows.toLocaleString()} visible</span>}
        <span className="tb-sep" />
        <select value={filterColumn} onChange={event => setFilterColumn(Number(event.target.value))} aria-label="Filter column">{columns.map((column, index) => <option value={index} key={`${column.name}-${index}`}>{column.name}</option>)}</select>
        <select value={filterOp} onChange={event => setFilterOp(event.target.value)} aria-label="Filter operator">{FILTER_OPS.map(operator => <option key={operator}>{operator}</option>)}</select>
        {!filterOp.includes('null') && <input className="result-filter-value" value={filterValue} onChange={event => setFilterValue(event.target.value)} onKeyDown={event => event.key === 'Enter' && addFilter()} placeholder="value" />}
        <button onClick={addFilter} disabled={!columns.length || !filterOp.includes('null') && !filterValue}>Add</button>
        {view.filters.map((filter, index) => <button className="result-filter-chip" key={index} onClick={() => updateFilters(view.filters.filter((_, itemIndex) => itemIndex !== index))} title="Remove filter">{filterLabel(filter)} ×</button>)}
        {expression && <button className="result-filter-chip" onClick={() => updateFilters(view.filters, null)} title="Remove advanced filter">Advanced · {advancedFilterCount} rules ×</button>}
        <button className={`icon-btn ${expression ? 'active' : ''}`} onClick={() => setShowAdvanced(true)} title="Advanced result filter"><ListTree size={13} /></button>
        <ResultFilterPresetMenu presets={presets} filters={view.filters} expression={expression} onSave={name => updatePresets([...presets, createResultFilterPreset(name, view.filters, expression)])} onApply={preset => onChange({ ...view, filters: preset.filters.map(filter => ({ ...filter, values: filter.values ? [...filter.values] : undefined })), expression: cloneExpression(preset.expression) })} onDelete={id => updatePresets(presets.filter(preset => preset.id !== id))} onClear={() => updateFilters([], null)} />
        <span className="tb-sep" />
        <select value={sortColumn} onChange={event => setSortColumn(Number(event.target.value))} aria-label="Sort column">{columns.map((column, index) => <option value={index} key={`${column.name}-${index}`}>{column.name}</option>)}</select>
        <div className="result-mode-sort" role="group" aria-label="Sort direction">
            <button className={`icon-btn ${selectedSort && !selectedSort.descending ? 'active' : ''}`} onClick={() => setSortDirection(false)} disabled={!columns.length} title="Sort ascending"><ArrowUpAZ size={13} /></button>
            <button className={`icon-btn ${selectedSort?.descending ? 'active' : ''}`} onClick={() => setSortDirection(true)} disabled={!columns.length} title="Sort descending"><ArrowDownAZ size={13} /></button>
            <button className="icon-btn" onClick={() => updateSorts(moveResultSort(sorts, sortColumn, -1))} disabled={selectedSortIndex <= 0} title="Increase sort priority"><ChevronLeft size={12} /></button>
            <button className="icon-btn" onClick={() => updateSorts(moveResultSort(sorts, sortColumn, 1))} disabled={selectedSortIndex < 0 || selectedSortIndex >= sorts.length - 1} title="Decrease sort priority"><ChevronRight size={12} /></button>
            <button className="icon-btn" onClick={() => updateSorts(sorts.filter(sort => sort.column !== sortColumn))} disabled={!selectedSort} title="Remove column sort"><X size={12} /></button>
        </div>
        {sorts.map((sort, index) => <button className={`result-sort-priority ${sort.column === sortColumn ? 'active' : ''}`} key={sort.column} onClick={() => setSortColumn(sort.column)} title={`Sort priority ${index + 1}`}>{index + 1} · {columns[sort.column]?.name} {sort.descending ? '↓' : '↑'}</button>)}
        {sorts.length > 1 && <button className="icon-btn" onClick={() => updateSorts([])} title="Clear all sorting"><X size={12} /></button>}
        <select value={view.analysisLimit ?? 0} onChange={event => onChange({ ...view, analysisLimit: Number(event.target.value) || null })} aria-label="Analysis row limit" title="Maximum rows used by non-grid views"><option value={0}>All rows</option>{[100, 500, 1000, 5000, 10000].map(limit => <option value={limit} key={limit}>{limit.toLocaleString()} rows</option>)}</select>
        <ResultColumnLayoutControl columns={columns} columnIds={columnIds} layout={columnLayout} presetContextKey={presetContextKey} onChange={onColumnLayoutChange} />
        {serverActive && <span className={`result-server-view ${serverBusy ? 'busy' : ''}`} title={serverBusy ? 'Refreshing filtered rows from the database' : 'Filters and sorting apply at the database'}><Database size={12} /></span>}
        {showAdvanced && <AdvancedResultFilterDialog columns={columns} filters={view.filters} expression={expression} engine={engine} onCancel={() => setShowAdvanced(false)} onApply={next => { updateFilters(view.filters, next); setShowAdvanced(false) }} />}
    </div>
}
