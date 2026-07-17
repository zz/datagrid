import { useMemo, useState } from 'react'
import { ListTree, Plus, Trash2 } from 'lucide-react'
import type { Column } from '../../ipc/types'
import type { ResultFilter, ResultFilterConjunction, ResultFilterExpression } from './resultProcessing'
import { buildServerFilterWhere } from './serverResultView'

const OPERATORS = ['contains', '=', '!=', '<', '>', '<=', '>=', 'starts', 'is null', 'is not null']
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const newFilter = (): ResultFilter => ({ column: 0, op: 'contains', value: '' })
const newGroup = () => ({ id: id(), conjunction: 'and' as const, filters: [newFilter()] })

const cloneExpression = (expression: ResultFilterExpression | null): ResultFilterExpression => expression
    ? { ...expression, groups: expression.groups.map(group => ({ ...group, filters: group.filters.map(filter => ({ ...filter, values: filter.values ? [...filter.values] : undefined })) })) }
    : { conjunction: 'and', groups: [newGroup()] }

function ConjunctionControl({ value, onChange, labels }: { value: ResultFilterConjunction; onChange: (value: ResultFilterConjunction) => void; labels: [string, string] }) {
    return <div className="advanced-filter-conjunction"><button className={value === 'and' ? 'active' : ''} onClick={() => onChange('and')}>{labels[0]}</button><button className={value === 'or' ? 'active' : ''} onClick={() => onChange('or')}>{labels[1]}</button></div>
}

export default function AdvancedResultFilterDialog({ columns, filters, expression, engine, onCancel, onApply }: {
    columns: Column[]
    filters: ResultFilter[]
    expression: ResultFilterExpression | null
    engine: string
    onCancel: () => void
    onApply: (expression: ResultFilterExpression | null) => void
}) {
    const [draft, setDraft] = useState(() => cloneExpression(expression))
    const updateGroup = (groupId: string, update: (group: ResultFilterExpression['groups'][number]) => ResultFilterExpression['groups'][number]) => setDraft(current => ({ ...current, groups: current.groups.map(group => group.id === groupId ? update(group) : group) }))
    const valid = draft.groups.length > 0 && draft.groups.every(group => group.filters.length > 0 && group.filters.every(filter => columns[filter.column] && (filter.op.includes('null') || filter.value.length > 0)))
    const preview = useMemo(() => buildServerFilterWhere(columns, filters, valid ? draft : null, engine), [columns, draft, engine, filters, valid])

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
        <div className="modal advanced-result-filter-dialog">
            <header><ListTree size={15} /><h2>Advanced Result Filter</h2></header>
            <div className="advanced-filter-top"><span>Combine groups</span><ConjunctionControl value={draft.conjunction} onChange={conjunction => setDraft(current => ({ ...current, conjunction }))} labels={['Match all', 'Match any']} /></div>
            <div className="advanced-filter-groups">{draft.groups.map((group, groupIndex) => <section key={group.id}>
                <div className="advanced-filter-group-heading"><strong>Group {groupIndex + 1}</strong><ConjunctionControl value={group.conjunction} onChange={conjunction => updateGroup(group.id, current => ({ ...current, conjunction }))} labels={['All rules', 'Any rule']} /><button className="icon-btn" disabled={draft.groups.length === 1} onClick={() => setDraft(current => ({ ...current, groups: current.groups.filter(item => item.id !== group.id) }))} title="Remove group"><Trash2 size={11} /></button></div>
                <div className="advanced-filter-rules">{group.filters.map((filter, filterIndex) => <div key={`${group.id}-${filterIndex}`}>
                    <select value={filter.column} onChange={event => updateGroup(group.id, current => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, column: Number(event.target.value) } : item) }))}>{columns.map((column, index) => <option value={index} key={`${column.name}-${index}`}>{column.name}</option>)}</select>
                    <select value={filter.op} onChange={event => updateGroup(group.id, current => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, op: event.target.value } : item) }))}>{OPERATORS.map(operator => <option key={operator}>{operator}</option>)}</select>
                    {filter.op.includes('null') ? <span className="advanced-filter-no-value">No value</span> : <input value={filter.value} onChange={event => updateGroup(group.id, current => ({ ...current, filters: current.filters.map((item, index) => index === filterIndex ? { ...item, value: event.target.value } : item) }))} placeholder="value" />}
                    <button className="icon-btn" disabled={group.filters.length === 1} onClick={() => updateGroup(group.id, current => ({ ...current, filters: current.filters.filter((_, index) => index !== filterIndex) }))} title="Remove rule"><Trash2 size={11} /></button>
                </div>)}</div>
                <button className="advanced-filter-add" onClick={() => updateGroup(group.id, current => ({ ...current, filters: [...current.filters, newFilter()] }))}><Plus size={11} /> Add rule</button>
            </section>)}</div>
            <button className="advanced-filter-add-group" onClick={() => setDraft(current => ({ ...current, groups: [...current.groups, newGroup()] }))}><Plus size={12} /> Add group</button>
            <div className="advanced-filter-preview"><strong>SQL preview</strong><pre>{preview || 'No filter'}</pre></div>
            <div className="modal-buttons"><button disabled={!expression} onClick={() => onApply(null)}>Clear advanced</button><div className="spacer" /><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!valid} onClick={() => onApply(draft)}>Apply</button></div>
        </div>
    </div>
}
