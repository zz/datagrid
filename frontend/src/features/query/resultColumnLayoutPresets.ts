import type { ResultColumnLayout } from './resultColumnLayout'

export interface ResultColumnLayoutPreset {
    id: string
    name: string
    layout: ResultColumnLayout
    createdAt: number
}

const storageKey = (contextKey: string) => `datagrid.result-column-layout-presets.v1:${contextKey}`

const validLayout = (value: unknown): value is ResultColumnLayout => {
    if (!value || typeof value !== 'object') return false
    const layout = value as Partial<ResultColumnLayout>
    return Array.isArray(layout.order) && layout.order.every(column => typeof column === 'string')
        && Array.isArray(layout.hidden) && layout.hidden.every(column => typeof column === 'string')
        && typeof layout.frozen === 'number' && Number.isFinite(layout.frozen)
}

export function loadResultColumnLayoutPresets(contextKey: string, storage: Storage = window.localStorage): ResultColumnLayoutPreset[] {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(storageKey(contextKey)) ?? '[]')
        if (!Array.isArray(parsed)) return []
        return parsed.filter((item): item is ResultColumnLayoutPreset => {
            if (!item || typeof item !== 'object') return false
            const preset = item as Partial<ResultColumnLayoutPreset>
            return typeof preset.id === 'string' && typeof preset.name === 'string' && preset.name.trim().length > 0
                && typeof preset.createdAt === 'number' && validLayout(preset.layout)
        })
    } catch { return [] }
}

export function saveResultColumnLayoutPresets(contextKey: string, presets: ResultColumnLayoutPreset[], storage: Storage = window.localStorage) {
    try { storage.setItem(storageKey(contextKey), JSON.stringify(presets)) } catch { /* Persistence must not break result browsing. */ }
}

export function createResultColumnLayoutPreset(name: string, layout: ResultColumnLayout, now = Date.now()): ResultColumnLayoutPreset {
    return {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        layout: { order: [...layout.order], hidden: [...layout.hidden], frozen: layout.frozen },
        createdAt: now,
    }
}
