export interface SearchObject {
    connId: string
    connName: string
    schema: string
    kind: string
    name: string
    columns?: string[]
}

export interface DatabaseSearchMatch extends SearchObject {
    source: 'object' | 'column' | 'definition' | 'data'
    detail: string
    ddl?: string
    column?: string
}

export function metadataMatches(objects: SearchObject[], query: string): DatabaseSearchMatch[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    const matches: DatabaseSearchMatch[] = []
    objects.forEach(object => {
        const qualified = `${object.schema}.${object.name}`
        if (`${object.kind} ${qualified}`.toLowerCase().includes(needle)) {
            matches.push({ ...object, source: 'object', detail: qualified })
        }
        object.columns?.forEach(column => {
            if (column.toLowerCase().includes(needle)) matches.push({ ...object, source: 'column', detail: `${qualified}.${column}` })
        })
    })
    return matches
}

export function definitionMatch(object: SearchObject, query: string, ddl: string): DatabaseSearchMatch | null {
    const needle = query.trim().toLowerCase()
    const lower = ddl.toLowerCase()
    const index = lower.indexOf(needle)
    if (!needle || index < 0) return null
    const start = Math.max(0, index - 52)
    const end = Math.min(ddl.length, index + needle.length + 86)
    const snippet = `${start > 0 ? '...' : ''}${ddl.slice(start, end).replace(/\s+/g, ' ').trim()}${end < ddl.length ? '...' : ''}`
    return { ...object, source: 'definition', detail: snippet, ddl }
}
