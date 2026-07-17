import { resolveTableReference } from './sqlDiagnostics'

interface Source { table: string; alias: string; columns: string[] }

function sources(statement: string, schema: Record<string, string[]>, defaultSchema: string): Source[] {
    const output: Source[] = []
    const pattern = /\b(?:from|join)\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)(?:\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi
    let match: RegExpExecArray | null
    while ((match = pattern.exec(statement))) {
        const resolved = resolveTableReference(match[1], schema, defaultSchema)
        if (!resolved) continue
        const table = resolved.slice(resolved.indexOf('.') + 1)
        const candidateAlias = match[2]?.toLowerCase()
        const alias = candidateAlias && !['where', 'join', 'left', 'right', 'inner', 'outer', 'cross', 'on', 'group', 'order', 'limit'].includes(candidateAlias) ? match[2] : table
        output.push({ table, alias, columns: schema[resolved] ?? [] })
    }
    return output
}

export function expandWildcards(sql: string, schema: Record<string, string[]> = {}, defaultSchema = 'public'): string {
    return sql.split(/(?<=;)/).map(statement => {
        const available = sources(statement, schema, defaultSchema)
        if (!available.length) return statement
        let output = statement
        for (const source of available) {
            const qualified = new RegExp(`\\b${source.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\.\\s*\\*`, 'g')
            output = output.replace(qualified, source.columns.map(column => `${source.alias}.${column}`).join(', '))
        }
        if (available.length === 1) {
            const select = /\bselect\s+([\s\S]*?)\s+from\b/i.exec(output)
            if (select && /(^|,)\s*\*\s*(,|$)/.test(select[1])) {
                const replacement = select[1].replace(/(^|,)\s*\*\s*(?=,|$)/, (_, prefix: string) => `${prefix}${prefix ? ' ' : ''}${available[0].columns.map(column => `${available[0].alias}.${column}`).join(', ')}`)
                output = output.slice(0, select.index) + select[0].replace(select[1], replacement) + output.slice(select.index + select[0].length)
            }
        }
        return output
    }).join('')
}

export function qualifySelectColumns(sql: string, schema: Record<string, string[]> = {}, defaultSchema = 'public'): string {
    return sql.split(/(?<=;)/).map(statement => {
        const available = sources(statement, schema, defaultSchema)
        if (available.length !== 1) return statement
        const select = /\bselect\s+([\s\S]*?)\s+from\b/i.exec(statement)
        if (!select) return statement
        const source = available[0]
        const columns = new Set(source.columns.map(column => column.toLowerCase()))
        const replacement = select[1].split(',').map(part => {
            const match = /^(\s*)([A-Za-z_][\w$]*)(\s+(?:as\s+)?[A-Za-z_][\w$]*)?(\s*)$/i.exec(part)
            if (!match || !columns.has(match[2].toLowerCase())) return part
            return `${match[1]}${source.alias}.${match[2]}${match[3] ?? ''}${match[4]}`
        }).join(',')
        return statement.slice(0, select.index) + select[0].replace(select[1], replacement) + statement.slice(select.index + select[0].length)
    }).join('')
}
