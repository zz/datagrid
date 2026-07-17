export interface SQLDiagnostic {
    from: number
    to: number
    severity: 'warning' | 'error'
    message: string
    replacement?: string
    insertWhereAt?: number
}

interface Token { text: string; lower: string; from: number; to: number }

function tokens(sql: string): Token[] {
    const output: Token[] = []
    let state: 'single' | 'double' | 'backtick' | 'line' | 'block' | null = null
    for (let index = 0; index < sql.length;) {
        if (state === 'line') { if (sql[index++] === '\n') state = null; continue }
        if (state === 'block') { if (sql[index] === '*' && sql[index + 1] === '/') { state = null; index += 2 } else index++; continue }
        if (state) {
            const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`'
            if (sql[index] === quote) { if (sql[index + 1] === quote) index += 2; else { state = null; index++ } } else index++
            continue
        }
        if (sql.startsWith('--', index) || sql[index] === '#') { state = 'line'; index += sql[index] === '#' ? 1 : 2; continue }
        if (sql.startsWith('/*', index)) { state = 'block'; index += 2; continue }
        if (sql[index] === "'") { state = 'single'; index++; continue }
        if (sql[index] === '"') { state = 'double'; index++; continue }
        if (sql[index] === '`') { state = 'backtick'; index++; continue }
        const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index))
        if (word) { output.push({ text: word[0], lower: word[0].toLowerCase(), from: index, to: index + word[0].length }); index += word[0].length; continue }
        if ('.;,()'.includes(sql[index])) output.push({ text: sql[index], lower: sql[index], from: index, to: index + 1 })
        index++
    }
    return output
}

const reserved = new Set(['where', 'join', 'left', 'right', 'full', 'inner', 'outer', 'cross', 'on', 'group', 'order', 'limit', 'offset', 'union', 'returning', 'set', 'values'])

function distance(left: string, right: string): number {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index)
    for (let i = 1; i <= left.length; i++) {
        let previous = row[0]
        row[0] = i
        for (let j = 1; j <= right.length; j++) {
            const saved = row[j]
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1))
            previous = saved
        }
    }
    return row[right.length]
}

function closest(value: string, choices: string[]): string | undefined {
    const ranked = choices.map(choice => ({ choice, score: distance(value.toLowerCase(), choice.toLowerCase()) })).sort((a, b) => a.score - b.score)
    return ranked[0] && ranked[0].score <= 2 && ranked[0].score < (ranked[1]?.score ?? Infinity) ? ranked[0].choice : undefined
}

export function inspectSQL(sql: string, schema: Record<string, string[]> = {}, defaultSchema = 'public'): SQLDiagnostic[] {
    const result: SQLDiagnostic[] = []
    const stream = tokens(sql)
    const byLower = new Map(Object.entries(schema).map(([name, columns]) => [name.toLowerCase(), { name, columns }]))
    const ctes = new Set<string>()
    for (let index = 0; index < stream.length - 1; index++) {
        if ((stream[index - 1]?.lower === 'with' || stream[index - 1]?.text === ',') && stream[index + 1]?.lower === 'as') ctes.add(stream[index].lower)
    }
    const aliases = new Map<string, string[]>()
    for (let index = 0; index < stream.length; index++) {
        if (!['from', 'join', 'update', 'into'].includes(stream[index].lower)) continue
        const first = stream[index + 1]
        if (!first || first.text === '(') continue
        let tableToken = first
        let qualifiedName = `${defaultSchema}.${first.text}`
        let cursor = index + 2
        if (stream[cursor]?.text === '.' && stream[cursor + 1]) {
            qualifiedName = `${first.text}.${stream[cursor + 1].text}`
            tableToken = stream[cursor + 1]
            cursor += 2
        }
        const found = byLower.get(qualifiedName.toLowerCase()) ?? [...byLower.values()].find(item => item.name.toLowerCase().endsWith(`.${tableToken.lower}`))
        if (!found && !ctes.has(tableToken.lower)) {
            const suggestion = closest(tableToken.text, [...byLower.values()].map(item => item.name.slice(item.name.indexOf('.') + 1)))
            result.push({ from: first.from, to: tableToken.to, severity: 'error', message: `Unknown table ${qualifiedName}`, replacement: suggestion })
            continue
        }
        if (!found) continue
        aliases.set(tableToken.lower, found.columns)
        if (stream[cursor]?.lower === 'as') cursor++
        const alias = stream[cursor]
        if (alias && /^[A-Za-z_]/.test(alias.text) && !reserved.has(alias.lower)) aliases.set(alias.lower, found.columns)
    }
    for (let index = 0; index < stream.length - 2; index++) {
        if (stream[index + 1].text !== '.') continue
        const columns = aliases.get(stream[index].lower)
        const column = stream[index + 2]
        if (columns && /^[A-Za-z_]/.test(column.text) && !columns.some(name => name.toLowerCase() === column.lower)) {
            result.push({ from: column.from, to: column.to, severity: 'error', message: `Unknown column ${stream[index].text}.${column.text}`, replacement: closest(column.text, columns) })
        }
    }
    let statementStart = 0
    for (let index = 0; index <= stream.length; index++) {
        if (index < stream.length && stream[index].text !== ';') continue
        const statement = stream.slice(statementStart, index)
        const destructive = statement.find(token => token.lower === 'update' || token.lower === 'delete')
        if (destructive && !statement.some(token => token.lower === 'where')) result.push({
            from: destructive.from, to: destructive.to, severity: 'warning',
            message: `${destructive.lower.toUpperCase()} has no WHERE clause and may affect every row`,
            insertWhereAt: index < stream.length ? stream[index].from : sql.length,
        })
        statementStart = index + 1
    }
    return result
}

export function resolveTableReference(reference: string, schema: Record<string, string[]> = {}, defaultSchema = 'public'): string | undefined {
    const names = Object.keys(schema)
    const exact = names.find(name => name.toLowerCase() === reference.toLowerCase())
    if (exact) return exact
    const preferred = names.find(name => name.toLowerCase() === `${defaultSchema}.${reference}`.toLowerCase())
    if (preferred) return preferred
    const matches = names.filter(name => name.toLowerCase().endsWith(`.${reference.toLowerCase()}`))
    return matches.length === 1 ? matches[0] : undefined
}
