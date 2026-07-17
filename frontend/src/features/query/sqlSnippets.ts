export interface SQLSnippet {
    id: string
    name: string
    trigger: string
    sql: string
    builtin?: boolean
}

export const BUILTIN_SNIPPETS: SQLSnippet[] = [
    { id: 'builtin-select', name: 'Select rows', trigger: 'sel', builtin: true, sql: 'SELECT $CURSOR$\nFROM table_name\nWHERE condition;' },
    { id: 'builtin-insert', name: 'Insert row', trigger: 'ins', builtin: true, sql: 'INSERT INTO table_name (column_name)\nVALUES ($CURSOR$);' },
    { id: 'builtin-update', name: 'Update rows', trigger: 'upd', builtin: true, sql: 'UPDATE table_name\nSET column_name = $CURSOR$\nWHERE condition;' },
    { id: 'builtin-cte', name: 'Common table expression', trigger: 'cte', builtin: true, sql: 'WITH source AS (\n    SELECT $CURSOR$\n    FROM table_name\n)\nSELECT *\nFROM source;' },
    { id: 'builtin-transaction', name: 'Transaction block', trigger: 'txn', builtin: true, sql: 'BEGIN;\n\n$CURSOR$\n\nCOMMIT;' },
]

const STORAGE_KEY = 'datagrid.sql-snippets.v1'

export function loadSQLSnippets(): SQLSnippet[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.name === 'string' && typeof item.sql === 'string').map((item, index) => ({
            id: typeof item.id === 'string' ? item.id : `restored-${index}`,
            name: item.name,
            trigger: typeof item.trigger === 'string' && item.trigger ? item.trigger : snippetTrigger(item.name),
            sql: item.sql,
        })) : []
    } catch { return [] }
}

export function saveSQLSnippets(snippets: SQLSnippet[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets.filter(snippet => !snippet.builtin)))
}

export function snippetTrigger(name: string): string {
    return name.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'snippet'
}

export function renderSnippet(sql: string): { text: string; cursor: number } {
    const marker = sql.indexOf('$CURSOR$')
    if (marker < 0) return { text: sql, cursor: sql.length }
    return { text: sql.replace('$CURSOR$', ''), cursor: marker }
}
