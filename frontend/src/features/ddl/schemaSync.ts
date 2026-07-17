import { drivers } from '../../../wailsjs/go/models'
import { generateMetadataMigration } from './metadataMigration'

const quote = (engine: string, value: string) => engine === 'mysql' ? `\`${value.replace(/`/g, '``')}\`` : `"${value.replace(/"/g, '""')}"`
const qualified = (engine: string, schema: string, table: string) => `${quote(engine, schema)}.${quote(engine, table)}`

export interface MissingTableMigration { create: string; constraints: string }

export function generateMissingTableMigration(engine: string, origin: drivers.TableInfo, targetSchema: string): MissingTableMigration {
    const definitions = origin.columns.map(column => {
        let definition = `${quote(engine, column.name)} ${column.typeName} ${column.nullable ? 'NULL' : 'NOT NULL'}`
        if (column.default.trim()) definition += ` DEFAULT ${column.default.trim()}`
        return `  ${definition}`
    })
    const create = `CREATE TABLE ${qualified(engine, targetSchema, origin.table)} (\n${definitions.join(',\n')}\n);`
    const foreignKeys = (origin.foreignKeys ?? []).map(key => ({
        ...key,
        referencedSchema: key.referencedSchema === origin.schema ? targetSchema : key.referencedSchema,
    }))
    const constraints = (origin.constraints ?? []).map(constraint => {
        if (engine !== 'postgres' || constraint.kind !== 'foreign_key') return constraint
        const key = foreignKeys.find(item => item.name === constraint.name)
        if (!key) return constraint
        return {
            ...constraint,
            definition: `FOREIGN KEY (${key.columns.map(name => quote(engine, name)).join(', ')}) REFERENCES ${qualified(engine, key.referencedSchema, key.referencedTable)} (${key.referencedColumns.map(name => quote(engine, name)).join(', ')}) ON UPDATE ${key.onUpdate} ON DELETE ${key.onDelete}`,
        }
    })
    const mapped = drivers.TableInfo.createFrom({
        ...origin,
        schema: targetSchema,
        constraints,
        foreignKeys,
    })
    const empty = drivers.TableInfo.createFrom({ schema: targetSchema, table: origin.table, columns: origin.columns, primaryKey: [], constraints: [], foreignKeys: [], indexes: [] })
    return { create, constraints: generateMetadataMigration(engine, mapped, empty).after }
}

export function generateDropTable(engine: string, schema: string, table: string): string {
    return `DROP TABLE ${qualified(engine, schema, table)};`
}
