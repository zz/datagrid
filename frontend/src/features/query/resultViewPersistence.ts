import type { ResultFilter, ResultFilterExpression, ResultSort, ResultViewState } from './resultProcessing'

export const emptyResultViewState = (): ResultViewState => ({ filters: [], expression: null, search: '', sort: null, sorts: [], analysisLimit: null })

const validFilter = (value: unknown, columnCount: number): value is ResultFilter => {
    if (!value || typeof value !== 'object') return false
    const filter = value as Partial<ResultFilter>
    return Number.isInteger(filter.column) && (filter.column ?? -1) >= 0 && (filter.column ?? columnCount) < columnCount
        && typeof filter.op === 'string' && typeof filter.value === 'string'
        && (filter.values === undefined || Array.isArray(filter.values) && filter.values.every(item => typeof item === 'string'))
        && (filter.includeNull === undefined || typeof filter.includeNull === 'boolean')
}

const normalizeExpression = (value: unknown, columnCount: number): ResultFilterExpression | null => {
    if (!value || typeof value !== 'object') return null
    const expression = value as Partial<ResultFilterExpression>
    if (expression.conjunction !== 'and' && expression.conjunction !== 'or' || !Array.isArray(expression.groups)) return null
    const groups = expression.groups.flatMap(group => {
        if (!group || typeof group !== 'object') return []
        const candidate = group as Partial<ResultFilterExpression['groups'][number]>
        if (typeof candidate.id !== 'string' || candidate.conjunction !== 'and' && candidate.conjunction !== 'or' || !Array.isArray(candidate.filters)) return []
        const filters = candidate.filters.filter(filter => validFilter(filter, columnCount))
        return filters.length ? [{ id: candidate.id, conjunction: candidate.conjunction, filters }] : []
    })
    return groups.length ? { conjunction: expression.conjunction, groups } : null
}

export function normalizeResultViewState(value: unknown, columnCount: number): ResultViewState {
    if (!value || typeof value !== 'object') return emptyResultViewState()
    const view = value as Partial<ResultViewState>
    const filters = Array.isArray(view.filters) ? view.filters.filter(filter => validFilter(filter, columnCount)) : []
    const validSort = (sort: unknown): sort is ResultSort => !!sort && typeof sort === 'object' && Number.isInteger((sort as ResultSort).column)
        && (sort as ResultSort).column >= 0 && (sort as ResultSort).column < columnCount && typeof (sort as ResultSort).descending === 'boolean'
    const candidates = Array.isArray(view.sorts) ? view.sorts.filter(validSort) : validSort(view.sort) ? [view.sort] : []
    const seen = new Set<number>()
    const sorts = candidates.filter(sort => {
        if (seen.has(sort.column)) return false
        seen.add(sort.column)
        return true
    })
    const analysisLimit = Number.isInteger(view.analysisLimit) && (view.analysisLimit ?? 0) > 0 && (view.analysisLimit ?? 0) <= 100_000 ? view.analysisLimit! : null
    return { filters, expression: normalizeExpression(view.expression, columnCount), search: typeof view.search === 'string' ? view.search : '', sort: sorts[0] ?? null, sorts, analysisLimit }
}

export function resultViewStorageKey(contextKey: string, columns: Array<{ name: string; typeName: string }>): string {
    const schema = columns.map(column => `${encodeURIComponent(column.name)}:${encodeURIComponent(column.typeName)}`).join('|')
    return `datagrid.result-view.v1:${encodeURIComponent(contextKey)}:${schema}`
}

export function loadResultViewState(key: string, columnCount: number, storage: Storage = window.localStorage): ResultViewState {
    try { return normalizeResultViewState(JSON.parse(storage.getItem(key) ?? 'null'), columnCount) } catch { return emptyResultViewState() }
}

export function saveResultViewState(key: string, view: ResultViewState, storage: Storage = window.localStorage) {
    try { storage.setItem(key, JSON.stringify(view)) } catch { /* Persistence must not break result browsing. */ }
}
