import type { Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'

export interface ResultFilter {
    column: number
    op: string
    value: string
    values?: string[]
    includeNull?: boolean
}

export type ResultFilterConjunction = 'and' | 'or'

export interface ResultFilterGroup {
    id: string
    conjunction: ResultFilterConjunction
    filters: ResultFilter[]
}

export interface ResultFilterExpression {
    conjunction: ResultFilterConjunction
    groups: ResultFilterGroup[]
}

export interface ResultSort {
    column: number
    descending: boolean
}

export interface ResultViewState {
    filters: ResultFilter[]
    expression?: ResultFilterExpression | null
    search: string
    sort: ResultSort | null
    sorts?: ResultSort[]
    analysisLimit?: number | null
}

export function resultViewSorts(view: Pick<ResultViewState, 'sort' | 'sorts'>): ResultSort[] {
    return view.sorts ?? (view.sort ? [view.sort] : [])
}

export function withResultSorts(view: ResultViewState, sorts: ResultSort[]): ResultViewState {
    return { ...view, sort: sorts[0] ?? null, sorts }
}

export function toggleResultSort(sorts: ResultSort[], column: number, additive: boolean): ResultSort[] {
    const index = sorts.findIndex(sort => sort.column === column)
    if (!additive) {
        if (index !== 0 || sorts.length !== 1) return [{ column, descending: false }]
        return sorts[0].descending ? [] : [{ column, descending: true }]
    }
    if (index < 0) return [...sorts, { column, descending: false }]
    if (!sorts[index].descending) return sorts.map((sort, itemIndex) => itemIndex === index ? { ...sort, descending: true } : sort)
    return sorts.filter((_, itemIndex) => itemIndex !== index)
}

export function moveResultSort(sorts: ResultSort[], column: number, direction: -1 | 1): ResultSort[] {
    const index = sorts.findIndex(sort => sort.column === column)
    const target = index + direction
    if (index < 0 || target < 0 || target >= sorts.length) return sorts
    const next = [...sorts]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
}

const numeric = (value?: Value) => value && ['i64', 'f64'].includes(value.t) && Number.isFinite(Number(value.v)) ? Number(value.v) : null
const text = (value?: Value) => value ? displayValue(value) : ''

function matchesResultFilter(row: Value[], filter: ResultFilter): boolean {
    const cell = row[filter.column]
    if (filter.op === 'in') {
        if (!cell || cell.t === 'null') return filter.includeNull === true
        const values = filter.values ?? []
        const leftNumber = numeric(cell)
        if (leftNumber != null) return values.some(value => Number.isFinite(Number(value)) && leftNumber === Number(value))
        const left = text(cell).toLowerCase()
        return values.some(value => left === value.toLowerCase())
    }
    if (filter.op === 'is null') return !cell || cell.t === 'null'
    if (filter.op === 'is not null') return !!cell && cell.t !== 'null'
    if (!cell || cell.t === 'null') return false
    const leftNumber = numeric(cell)
    const rightNumber = Number(filter.value)
    const useNumber = leftNumber != null && Number.isFinite(rightNumber)
    const left = useNumber ? leftNumber : text(cell).toLowerCase()
    const right = useNumber ? rightNumber : filter.value.toLowerCase()
    switch (filter.op) {
        case '=': return left === right
        case '!=': return left !== right
        case '<': return left < right
        case '>': return left > right
        case '<=': return left <= right
        case '>=': return left >= right
        case 'starts': return String(left).startsWith(String(right))
        default: return String(left).includes(String(right))
    }
}

export function filterResultRows(rows: Value[][], filters: ResultFilter[]): Value[][] {
    return rows.filter(row => filters.every(filter => matchesResultFilter(row, filter)))
}

export function filterResultExpressionRows(rows: Value[][], expression: ResultFilterExpression | null | undefined): Value[][] {
    if (!expression?.groups.length) return rows
    return rows.filter(row => {
        const groupMatches = expression.groups.filter(group => group.filters.length > 0).map(group => {
            const matches = group.filters.map(filter => matchesResultFilter(row, filter))
            return group.conjunction === 'and' ? matches.every(Boolean) : matches.some(Boolean)
        })
        if (!groupMatches.length) return true
        return expression.conjunction === 'and' ? groupMatches.every(Boolean) : groupMatches.some(Boolean)
    })
}

export function resultFilterExpressionColumns(expression: ResultFilterExpression | null | undefined): Set<number> {
    return new Set(expression?.groups.flatMap(group => group.filters.map(filter => filter.column)) ?? [])
}

export function withoutResultFilterExpressionColumn(expression: ResultFilterExpression | null | undefined, column: number): ResultFilterExpression | null {
    if (!expression) return null
    const groups = expression.groups.map(group => ({ ...group, filters: group.filters.filter(filter => filter.column !== column) })).filter(group => group.filters.length > 0)
    return groups.length ? { ...expression, groups } : null
}

export function processResultRows(rows: Value[][], view: ResultViewState): Value[][] {
    let output = filterResultRows(rows, view.filters)
    output = filterResultExpressionRows(output, view.expression)
    const search = view.search.trim().toLowerCase()
    if (search) output = output.filter(row => row.some(cell => cell && cell.t !== 'null' && String(cell.v ?? '').toLowerCase().includes(search)))
    const sorts = resultViewSorts(view)
    if (sorts.length) output = sortResultRowsByColumns(output, sorts)
    return output
}

export function limitResultRows(rows: Value[][], limit: number | null | undefined): Value[][] {
    return limit && limit > 0 && rows.length > limit ? rows.slice(0, limit) : rows
}

export function sortResultRows(rows: Value[][], column: number, descending = false): Value[][] {
    return sortResultRowsByColumns(rows, [{ column, descending }])
}

export function sortResultRowsByColumns(rows: Value[][], sorts: ResultSort[]): Value[][] {
    return rows.map((row, index) => ({ row, index })).sort((left, right) => {
        for (const sort of sorts) {
            const a = left.row[sort.column]
            const b = right.row[sort.column]
            if (!a || a.t === 'null') {
                if (b && b.t !== 'null') return 1
                continue
            }
            if (!b || b.t === 'null') return -1
            const an = numeric(a)
            const bn = numeric(b)
            const compared = an != null && bn != null ? an - bn : text(a).localeCompare(text(b), undefined, { numeric: true })
            if (compared) return sort.descending ? -compared : compared
        }
        return left.index - right.index
    }).map(item => item.row)
}

export interface ColumnStatistics { count: number; nulls: number; distinct: number; numericCount: number; sum: number; min?: number; max?: number }

export interface DistinctColumnValue { value: string; count: number; isNull: boolean }

export function distinctColumnValues(rows: Value[][], column: number): DistinctColumnValue[] {
    const counts = new Map<string, DistinctColumnValue>()
    rows.forEach(row => {
        const cell = row[column]
        if (cell?.ref || cell?.t === 'bytes') return
        const isNull = !cell || cell.t === 'null'
        const value = isNull ? '' : displayValue(cell)
        const key = isNull ? '\u0000null' : `value:${value}`
        const current = counts.get(key)
        if (current) current.count++
        else counts.set(key, { value, count: 1, isNull })
    })
    return [...counts.values()].sort((left, right) => left.isNull ? -1 : right.isNull ? 1 : left.value.localeCompare(right.value, undefined, { numeric: true }))
}

export function columnStatistics(rows: Value[][], column: number): ColumnStatistics {
    const values = rows.map(row => row[column])
    const present = values.filter(value => value && value.t !== 'null') as Value[]
    const numbers = present.map(numeric).filter((value): value is number => value != null)
    return {
        count: present.length,
        nulls: values.length - present.length,
        distinct: new Set(present.map(text)).size,
        numericCount: numbers.length,
        sum: numbers.reduce((total, value) => total + value, 0),
        min: numbers.length ? Math.min(...numbers) : undefined,
        max: numbers.length ? Math.max(...numbers) : undefined,
    }
}
