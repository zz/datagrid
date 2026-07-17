const STORAGE_KEY = 'datagrid.sql-bookmarks.v1'

export type SQLBookmarks = Record<string, number[]>

export function loadSQLBookmarks(storage: Storage = localStorage): SQLBookmarks {
    try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        return Object.fromEntries(Object.entries(parsed).map(([id, lines]) => [id, Array.isArray(lines)
            ? [...new Set(lines.filter(line => Number.isInteger(line) && line > 0))].sort((a, b) => a - b)
            : []]))
    } catch { return {} }
}

export function saveSQLBookmarks(bookmarks: SQLBookmarks, storage: Storage = localStorage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(bookmarks))
}

export function linePreview(sql: string, line: number): string {
    return sql.split('\n')[line - 1]?.trim().slice(0, 90) || '(blank line)'
}
