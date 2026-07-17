export function queryParameterNames(sql: string, engine: string = 'postgres'): string[] {
    const names: string[] = []
    let quote = ''
    let lineComment = false
    let blockComment = false
    let dollarTag = ''
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i]
        if (dollarTag) {
            if (sql.startsWith(dollarTag, i)) { i += dollarTag.length - 1; dollarTag = '' }
            continue
        }
        if (lineComment) {
            if (ch === '\n') lineComment = false
            continue
        }
        if (blockComment) {
            if (ch === '*' && sql[i + 1] === '/') { blockComment = false; i++ }
            continue
        }
        if (quote) {
            if (ch === '\\') { i++; continue }
            if (ch === quote) {
                if (sql[i + 1] === quote) i++
                else quote = ''
            }
            continue
        }
        if (ch === '-' && sql[i + 1] === '-') { lineComment = true; i++; continue }
        if (ch === '#' && engine === 'mysql') { lineComment = true; continue }
        if (ch === '/' && sql[i + 1] === '*') { blockComment = true; i++; continue }
        if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
        if (ch === '$' && engine === 'postgres') {
            const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/)
            if (match) { dollarTag = match[0]; i += dollarTag.length - 1; continue }
        }
        if (ch === ':' && sql[i - 1] !== ':' && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
            let end = i + 2
            while (/[A-Za-z0-9_]/.test(sql[end] ?? '')) end++
            const name = sql.slice(i + 1, end)
            if (!names.includes(name)) names.push(name)
            i = end - 1
        }
    }
    return names
}
