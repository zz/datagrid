import { drivers } from '../../../wailsjs/go/models'

export interface ColumnDraft {
    originalName?: string
    name: string
    typeName: string
    nullable: boolean
    default: string
}

const quote = (engine: string, value: string) => engine === 'mysql'
    ? `\`${value.replace(/`/g, '``')}\``
    : `"${value.replace(/"/g, '""')}"`

const qualified = (engine: string, schema: string, table: string) => `${quote(engine, schema)}.${quote(engine, table)}`

const definition = (engine: string, column: ColumnDraft) => {
    let sql = `${quote(engine, column.name)} ${column.typeName}`
    sql += column.nullable ? ' NULL' : ' NOT NULL'
    if (column.default.trim()) sql += ` DEFAULT ${column.default.trim()}`
    return sql
}

export function generateColumnMigration(
    engine: string,
    schema: string,
    table: string,
    original: drivers.ColumnInfo[],
    drafts: ColumnDraft[],
): string {
    const target = qualified(engine, schema, table)
    const statements: string[] = []
    const byOriginal = new Map(drafts.filter(draft => draft.originalName).map(draft => [draft.originalName!, draft]))

    for (const column of original) {
        const draft = byOriginal.get(column.name)
        if (!draft) {
            statements.push(`ALTER TABLE ${target} DROP COLUMN ${quote(engine, column.name)};`)
            continue
        }
        const changed = draft.name !== column.name || draft.typeName !== column.typeName || draft.nullable !== column.nullable || draft.default.trim() !== column.default.trim()
        if (!changed) continue
        if (engine === 'mysql') {
            const action = draft.name === column.name ? 'MODIFY COLUMN' : `CHANGE COLUMN ${quote(engine, column.name)}`
            statements.push(`ALTER TABLE ${target} ${action} ${definition(engine, draft)};`)
            continue
        }
        if (draft.name !== column.name) statements.push(`ALTER TABLE ${target} RENAME COLUMN ${quote(engine, column.name)} TO ${quote(engine, draft.name)};`)
        const current = quote(engine, draft.name)
        if (draft.typeName !== column.typeName) statements.push(`ALTER TABLE ${target} ALTER COLUMN ${current} TYPE ${draft.typeName};`)
        if (draft.nullable !== column.nullable) statements.push(`ALTER TABLE ${target} ALTER COLUMN ${current} ${draft.nullable ? 'DROP' : 'SET'} NOT NULL;`)
        if (draft.default.trim() !== column.default.trim()) statements.push(`ALTER TABLE ${target} ALTER COLUMN ${current} ${draft.default.trim() ? `SET DEFAULT ${draft.default.trim()}` : 'DROP DEFAULT'};`)
    }
    for (const draft of drafts.filter(draft => !draft.originalName)) {
        statements.push(`ALTER TABLE ${target} ADD COLUMN ${definition(engine, draft)};`)
    }
    return statements.join('\n')
}
