import type { ResultFilter, ResultFilterExpression } from './resultProcessing'

export interface ResultFilterPreset {
    id: string
    name: string
    filters: ResultFilter[]
    expression?: ResultFilterExpression
    createdAt: number
}

const storageKey = (contextKey: string) => `datagrid.result-filter-presets.v1:${contextKey}`

function validFilter(value: unknown): value is ResultFilter {
    if (!value || typeof value !== 'object') return false
    const filter = value as Partial<ResultFilter>
    return Number.isInteger(filter.column) && (filter.column ?? -1) >= 0 && typeof filter.op === 'string' && typeof filter.value === 'string'
        && (filter.values === undefined || Array.isArray(filter.values) && filter.values.every(item => typeof item === 'string'))
        && (filter.includeNull === undefined || typeof filter.includeNull === 'boolean')
}

function validExpression(value: unknown): value is ResultFilterExpression {
    if (!value || typeof value !== 'object') return false
    const expression = value as Partial<ResultFilterExpression>
    return (expression.conjunction === 'and' || expression.conjunction === 'or') && Array.isArray(expression.groups) && expression.groups.every(group => {
        if (!group || typeof group !== 'object') return false
        const candidate = group as Partial<ResultFilterExpression['groups'][number]>
        return typeof candidate.id === 'string' && (candidate.conjunction === 'and' || candidate.conjunction === 'or') && Array.isArray(candidate.filters) && candidate.filters.every(validFilter)
    })
}

export function loadResultFilterPresets(contextKey: string, storage: Storage = window.localStorage): ResultFilterPreset[] {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(storageKey(contextKey)) ?? '[]')
        if (!Array.isArray(parsed)) return []
        return parsed.filter((item): item is ResultFilterPreset => {
            if (!item || typeof item !== 'object') return false
            const preset = item as Partial<ResultFilterPreset>
            return typeof preset.id === 'string' && typeof preset.name === 'string' && preset.name.trim().length > 0
                && typeof preset.createdAt === 'number' && Array.isArray(preset.filters) && preset.filters.every(validFilter)
                && (preset.expression === undefined || validExpression(preset.expression))
        })
    } catch { return [] }
}

export function saveResultFilterPresets(contextKey: string, presets: ResultFilterPreset[], storage: Storage = window.localStorage) {
    try { storage.setItem(storageKey(contextKey), JSON.stringify(presets)) } catch { /* Persistence must not break result browsing. */ }
}

export function createResultFilterPreset(name: string, filters: ResultFilter[], expression: ResultFilterExpression | null = null, now = Date.now()): ResultFilterPreset {
    return {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        filters: filters.map(filter => ({ ...filter, values: filter.values ? [...filter.values] : undefined })),
        expression: expression ? { ...expression, groups: expression.groups.map(group => ({ ...group, filters: group.filters.map(filter => ({ ...filter, values: filter.values ? [...filter.values] : undefined })) })) } : undefined,
        createdAt: now,
    }
}
