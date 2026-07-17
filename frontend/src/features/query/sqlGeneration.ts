import { drivers } from '../../../wailsjs/go/models'

export type GeneratedStatementKind = 'select' | 'insert' | 'update' | 'delete' | 'upsert'

function quote(engine: string, identifier: string): string {
    const mark = engine === 'mysql' ? '`' : '"'
    return mark + identifier.replaceAll(mark, mark + mark) + mark
}

function parameter(name: string): string {
    return `:${name.replace(/\W+/g, '_')}`
}

export function generateTableSQL(engine: string, info: drivers.TableInfo, kind: GeneratedStatementKind, selected: string[]): string {
    const columns = info.columns.filter(column => selected.includes(column.name))
    const qualified = `${quote(engine, info.schema)}.${quote(engine, info.table)}`
    const keyColumns = info.primaryKey.length ? info.primaryKey : info.columns.slice(0, 1).map(column => column.name)
    const predicate = keyColumns.map(column => `${quote(engine, column)} = ${parameter(`key_${column}`)}`).join('\n    AND ')
    const names = columns.map(column => quote(engine, column.name))
    if (kind === 'select') return `SELECT\n    ${names.join(',\n    ')}\nFROM\n    ${qualified}\nWHERE\n    ${predicate};`
    if (kind === 'delete') return `DELETE FROM ${qualified}\nWHERE\n    ${predicate};`
    if (kind === 'insert') return `INSERT INTO ${qualified} (\n    ${names.join(',\n    ')}\n)\nVALUES (\n    ${columns.map(column => parameter(column.name)).join(',\n    ')}\n);`
    const mutable = columns.filter(column => !keyColumns.includes(column.name))
    if (kind === 'update') return `UPDATE ${qualified}\nSET\n    ${mutable.map(column => `${quote(engine, column.name)} = ${parameter(column.name)}`).join(',\n    ')}\nWHERE\n    ${predicate};`
    const insert = `INSERT INTO ${qualified} (\n    ${names.join(',\n    ')}\n)\nVALUES (\n    ${columns.map(column => parameter(column.name)).join(',\n    ')}\n)`
    if (engine === 'mysql') return `${insert}\nON DUPLICATE KEY UPDATE\n    ${mutable.map(column => `${quote(engine, column.name)} = VALUES(${quote(engine, column.name)})`).join(',\n    ')};`
    return `${insert}\nON CONFLICT (${keyColumns.map(column => quote(engine, column)).join(', ')})\nDO UPDATE SET\n    ${mutable.map(column => `${quote(engine, column.name)} = EXCLUDED.${quote(engine, column.name)}`).join(',\n    ')};`
}
