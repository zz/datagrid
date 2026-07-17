import { format } from 'sql-formatter'

export interface SQLFormatEdit {
    from: number
    to: number
    insert: string
    selectionFrom: number
    selectionTo: number
}

export function formatSQL(source: string, engine: string): string {
    if (!source.trim()) return source
    return format(source, {
        language: engine === 'mysql' ? 'mysql' : 'postgresql',
        keywordCase: 'upper',
        tabWidth: 4,
        useTabs: false,
        linesBetweenQueries: 2,
    })
}

export function formatSQLEdit(document: string, from: number, to: number, engine: string): SQLFormatEdit | null {
    const hasSelection = from !== to
    const editFrom = hasSelection ? from : 0
    const editTo = hasSelection ? to : document.length
    const source = document.slice(editFrom, editTo)
    if (!source.trim()) return null
    const insert = formatSQL(source, engine)
    if (insert === source) return null
    const end = editFrom + insert.length
    return {
        from: editFrom,
        to: editTo,
        insert,
        selectionFrom: hasSelection ? editFrom : Math.min(from, end),
        selectionTo: hasSelection ? end : Math.min(from, end),
    }
}
