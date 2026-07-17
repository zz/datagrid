const STORAGE_KEY = 'datagrid.query-execution-settings.v1'

export interface QueryExecutionSettings {
    timeoutSeconds: number
    rowLimit: number
    confirmDestructive: boolean
}

export const DEFAULT_EXECUTION_SETTINGS: QueryExecutionSettings = {
    timeoutSeconds: 0,
    rowLimit: 0,
    confirmDestructive: true,
}

export function normalizeExecutionSettings(value: Partial<QueryExecutionSettings>): QueryExecutionSettings {
    const timeoutSeconds = Number.isFinite(value.timeoutSeconds) ? Math.min(3600, Math.max(0, Math.round(value.timeoutSeconds!))) : 0
    const rowLimit = Number.isFinite(value.rowLimit) ? Math.min(1_000_000, Math.max(0, Math.round(value.rowLimit!))) : 0
    return { timeoutSeconds, rowLimit, confirmDestructive: value.confirmDestructive !== false }
}

function loadAll(storage: Storage): Record<string, QueryExecutionSettings> {
    try {
        const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item === 'object').map(([tabId, item]) => [tabId, normalizeExecutionSettings(item as Partial<QueryExecutionSettings>)]))
    } catch { return {} }
}

export function loadQueryExecutionSettings(tabId: string, storage: Storage = window.localStorage): QueryExecutionSettings {
    return loadAll(storage)[tabId] ?? { ...DEFAULT_EXECUTION_SETTINGS }
}

export function saveQueryExecutionSettings(tabId: string, settings: QueryExecutionSettings, storage: Storage = window.localStorage) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ ...loadAll(storage), [tabId]: normalizeExecutionSettings(settings) })) } catch { /* optional console preference */ }
}

export function isPageableResultStatement(statement: string): boolean {
    let head = statement.trim().toLowerCase()
    while (head.startsWith('(')) head = head.slice(1).trimStart()
    return head === 'select' || /^select(?:\s|$)/.test(head)
}
