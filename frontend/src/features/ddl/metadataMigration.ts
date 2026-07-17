import { drivers } from '../../../wailsjs/go/models'

const quote = (engine: string, value: string) => engine === 'mysql' ? `\`${value.replace(/`/g, '``')}\`` : `"${value.replace(/"/g, '""')}"`
const qualified = (engine: string, schema: string, name: string) => `${quote(engine, schema)}.${quote(engine, name)}`
const columns = (engine: string, names: string[]) => names.map(name => quote(engine, name)).join(', ')

export interface MetadataMigration { before: string; after: string }

export function generateMetadataMigration(engine: string, origin: drivers.TableInfo, target: drivers.TableInfo): MetadataMigration {
    const table = qualified(engine, target.schema, target.table)
    const before: string[] = []
    const after: string[] = []
    const originConstraints = new Map((origin.constraints ?? []).map(item => [item.name, item]))
    const targetConstraints = new Map((target.constraints ?? []).map(item => [item.name, item]))
    const equalConstraint = (a: drivers.ConstraintInfo, b: drivers.ConstraintInfo) => {
        if (a.kind !== b.kind || a.columns.join('\0') !== b.columns.join('\0') || a.definition !== b.definition) return false
        const left = (origin.foreignKeys ?? []).find(key => key.name === a.name)
        const right = (target.foreignKeys ?? []).find(key => key.name === b.name)
        if (!left && !right) return true
        return !!left && !!right && left.referencedSchema === right.referencedSchema && left.referencedTable === right.referencedTable &&
            left.columns.join('\0') === right.columns.join('\0') && left.referencedColumns.join('\0') === right.referencedColumns.join('\0') &&
            left.onUpdate === right.onUpdate && left.onDelete === right.onDelete
    }

    const dropConstraint = (constraint: drivers.ConstraintInfo) => {
        if (engine !== 'mysql') return `ALTER TABLE ${table} DROP CONSTRAINT ${quote(engine, constraint.name)};`
        if (constraint.kind === 'primary_key') return `ALTER TABLE ${table} DROP PRIMARY KEY;`
        if (constraint.kind === 'foreign_key') return `ALTER TABLE ${table} DROP FOREIGN KEY ${quote(engine, constraint.name)};`
        if (constraint.kind === 'check') return `ALTER TABLE ${table} DROP CHECK ${quote(engine, constraint.name)};`
        return `ALTER TABLE ${table} DROP INDEX ${quote(engine, constraint.name)};`
    }
    const addConstraint = (constraint: drivers.ConstraintInfo) => {
        if (engine !== 'mysql') return `ALTER TABLE ${table} ADD CONSTRAINT ${quote(engine, constraint.name)} ${constraint.definition};`
        if (constraint.kind === 'primary_key') return `ALTER TABLE ${table} ADD PRIMARY KEY (${columns(engine, constraint.columns)});`
        if (constraint.kind === 'unique') return `ALTER TABLE ${table} ADD CONSTRAINT ${quote(engine, constraint.name)} UNIQUE (${columns(engine, constraint.columns)});`
        if (constraint.kind === 'foreign_key') {
            const key = (origin.foreignKeys ?? []).find(item => item.name === constraint.name)
            if (!key) return ''
            return `ALTER TABLE ${table} ADD CONSTRAINT ${quote(engine, constraint.name)} FOREIGN KEY (${columns(engine, key.columns)}) REFERENCES ${qualified(engine, key.referencedSchema, key.referencedTable)} (${columns(engine, key.referencedColumns)}) ON UPDATE ${key.onUpdate} ON DELETE ${key.onDelete};`
        }
        return ''
    }

    targetConstraints.forEach((constraint, name) => {
        const wanted = originConstraints.get(name)
        if (!wanted || !equalConstraint(wanted, constraint)) before.push(dropConstraint(constraint))
    })
    originConstraints.forEach((constraint, name) => {
        const existing = targetConstraints.get(name)
        if (!existing || !equalConstraint(constraint, existing)) {
            const statement = addConstraint(constraint)
            if (statement) after.push(statement)
        }
    })

    const standalone = (info: drivers.TableInfo) => (info.indexes ?? []).filter(index => index.name !== 'PRIMARY' && !(info.constraints ?? []).some(constraint => constraint.name === index.name))
    const originIndexes = new Map(standalone(origin).map(item => [item.name, item]))
    const targetIndexes = new Map(standalone(target).map(item => [item.name, item]))
    const equalIndex = (a: drivers.IndexInfo, b: drivers.IndexInfo) => a.unique === b.unique && a.columns.join('\0') === b.columns.join('\0')
    targetIndexes.forEach((index, name) => {
        const wanted = originIndexes.get(name)
        if (!wanted || !equalIndex(wanted, index)) before.push(engine === 'mysql'
            ? `ALTER TABLE ${table} DROP INDEX ${quote(engine, name)};`
            : `DROP INDEX ${qualified(engine, target.schema, name)};`)
    })
    originIndexes.forEach((index, name) => {
        const existing = targetIndexes.get(name)
        if (!existing || !equalIndex(index, existing)) after.push(engine === 'mysql'
            ? `ALTER TABLE ${table} ADD ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(engine, name)} (${columns(engine, index.columns)});`
            : `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(engine, name)} ON ${table} (${columns(engine, index.columns)});`)
    })
    return { before: before.join('\n'), after: after.join('\n') }
}
