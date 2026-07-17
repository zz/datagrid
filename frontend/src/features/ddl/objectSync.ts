export type SchemaObjectKind = 'view' | 'sequence' | 'routine' | 'trigger'

const quote = (engine: string, value: string) => engine === 'mysql' ? `\`${value.replace(/`/g, '``')}\`` : `"${value.replace(/"/g, '""')}"`
const qualified = (engine: string, schema: string, name: string) => `${quote(engine, schema)}.${quote(engine, name)}`
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function normalizeObjectDDL(ddl: string, schema: string, name: string): string {
    let normalized = ddl.replace(/DEFINER\s*=\s*[^ ]+\s*/gi, '')
    for (const value of [`"${schema}"."${name}"`, `\`${schema}\`.\`${name}\``, `${schema}.${name}`]) {
        normalized = normalized.replace(new RegExp(escapeRegExp(value), 'gi'), '<object>')
    }
    for (const value of [`"${schema}".`, `\`${schema}\`.`, `${schema}.`]) {
        normalized = normalized.replace(new RegExp(escapeRegExp(value), 'gi'), '<schema>.')
    }
    return normalized.replace(/\s+/g, ' ').replace(/;$/, '').trim().toLowerCase()
}

export function remapObjectDDL(ddl: string, engine: string, originSchema: string, targetSchema: string): string {
    let mapped = ddl.replace(/DEFINER\s*=\s*[^ ]+\s*/gi, '')
    const replacements: Array<[string, string]> = [
        [`"${originSchema}".`, `"${targetSchema}".`],
        [`\`${originSchema}\`.`, `\`${targetSchema}\`.`],
        [`${originSchema}.`, `${targetSchema}.`],
    ]
    replacements.forEach(([from, to]) => { mapped = mapped.replace(new RegExp(escapeRegExp(from), 'g'), to) })
    if (engine === 'mysql' && /\bVIEW\b/i.test(mapped)) {
        mapped = mapped.replace(/^CREATE\s+/i, 'CREATE OR REPLACE ')
    }
    return mapped.trim()
}

export function objectDropSQL(engine: string, kind: SchemaObjectKind, schema: string, name: string, table = ''): string {
    if (kind === 'routine') return ''
    if (kind === 'trigger') {
        if (engine === 'mysql') return `DROP TRIGGER ${qualified(engine, schema, name)};`
        return table ? `DROP TRIGGER ${quote(engine, name)} ON ${qualified(engine, schema, table)};` : ''
    }
    return `DROP ${kind === 'view' ? 'VIEW' : 'SEQUENCE'} ${qualified(engine, schema, name)};`
}
