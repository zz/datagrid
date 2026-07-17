const STORAGE_KEY = 'datagrid.console-schema-context.v1'

function loadAll(storage: Storage): Record<string, string[]> {
    try {
        const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every(item => typeof item === 'string')))
    } catch { return {} }
}

export function normalizeSchemaContext(engine: string, schemas: string[]): string[] {
    const unique = [...new Set(schemas.map(schema => schema.trim()).filter(Boolean))]
    return engine === 'mysql' ? unique.slice(0, 1) : unique
}

export function schemaNames(autocomplete?: Record<string, string[]>): string[] {
    return [...new Set(Object.keys(autocomplete ?? {}).map(name => name.includes('.') ? name.slice(0, name.indexOf('.')) : '').filter(Boolean))].sort()
}

export function loadConsoleSchemaContext(tabId: string, fallback: string[], storage: Storage = window.localStorage): string[] {
    return loadAll(storage)[tabId] ?? fallback
}

export function saveConsoleSchemaContext(tabId: string, schemas: string[], storage: Storage = window.localStorage) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ ...loadAll(storage), [tabId]: schemas })) } catch { /* optional editor preference */ }
}
