import type { Column, Value } from '../../ipc/types'
import type { drivers } from '../../../wailsjs/go/models'

export interface EditableResultTarget {
    schema: string
    table: string
    columns: string[] | null
}

export interface EditableResultResolution {
    target: EditableResultTarget | null
    reason: string
}

export interface ResultCellEdit {
    rowIndex: number
    columnIndex: number
    cell: { null: boolean; text: string }
}

export interface EditableResultChange {
    rowIndex: number
    kind: 'update' | 'insert' | 'delete'
    key: Record<string, { null: boolean; text: string }>
    set: Record<string, { null: boolean; text: string }>
    original: Record<string, { null: boolean; text: string }>
}

const identifier = '(?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_$]*)'
const clauseStart = /^(where\b|order\s+by\b|limit\b|offset\b|fetch\b|for\s+(update|share)\b)/i

function unquoteIdentifier(value: string): string {
    if (value.startsWith('"')) return value.slice(1, -1).replaceAll('""', '"')
    if (value.startsWith('`')) return value.slice(1, -1).replaceAll('``', '`')
    return value
}

function splitProjection(value: string): string[] | null {
    const output: string[] = []
    let start = 0
    let quote = ''
    for (let index = 0; index < value.length; index++) {
        const char = value[index]
        if (quote) {
            if (char === quote) {
                if (value[index + 1] === quote) index++
                else quote = ''
            }
            continue
        }
        if (char === '"' || char === '`') quote = char
        else if (char === ',') {
            output.push(value.slice(start, index).trim())
            start = index + 1
        }
    }
    if (quote) return null
    output.push(value.slice(start).trim())
    return output.every(Boolean) ? output : null
}

export function resolveEditableResultTarget(statement: string, defaultSchema: string): EditableResultResolution {
    const sql = statement.trim().replace(/;+\s*$/, '')
    if (!/^select\b/i.test(sql)) return { target: null, reason: 'Only SELECT results can be edited.' }
    if (/\b(distinct|join|union|intersect|except|group\s+by|having|window)\b/i.test(sql)) {
        return { target: null, reason: 'Joined, grouped, or set-operation results are read-only.' }
    }
    const fromMatches = [...sql.matchAll(/\bfrom\b/gi)]
    if (fromMatches.length !== 1) return { target: null, reason: 'The result must come from one base table.' }
    const fromIndex = fromMatches[0].index!
    const projectionText = sql.slice('select'.length, fromIndex).trim()
    const rest = sql.slice(fromIndex + 'from'.length).trim()
    const tablePattern = new RegExp(`^(${identifier})(?:\\s*\\.\\s*(${identifier}))?`)
    const tableMatch = rest.match(tablePattern)
    if (!tableMatch) return { target: null, reason: 'The source table could not be identified.' }

    const qualified = !!tableMatch[2]
    const schema = qualified ? unquoteIdentifier(tableMatch[1]) : defaultSchema
    const table = unquoteIdentifier(qualified ? tableMatch[2] : tableMatch[1])
    let suffix = rest.slice(tableMatch[0].length).trim()
    let alias = ''
    const asAlias = suffix.match(new RegExp(`^as\\s+(${identifier})(?:\\s+|$)`, 'i'))
    if (asAlias) {
        alias = unquoteIdentifier(asAlias[1])
        suffix = suffix.slice(asAlias[0].length).trim()
    } else if (suffix && !clauseStart.test(suffix)) {
        const bareAlias = suffix.match(new RegExp(`^(${identifier})(?:\\s+|$)`))
        if (!bareAlias) return { target: null, reason: 'Only a single base-table source is editable.' }
        alias = unquoteIdentifier(bareAlias[1])
        suffix = suffix.slice(bareAlias[0].length).trim()
    }
    if (suffix && !clauseStart.test(suffix)) return { target: null, reason: 'Only direct base-table results are editable.' }

    const projections = splitProjection(projectionText)
    if (!projections) return { target: null, reason: 'The selected columns could not be mapped to the table.' }
    const allowedQualifiers = new Set([table, alias].filter(Boolean).map(value => value.toLowerCase()))
    if (projections.length === 1 && (projections[0] === '*' || projections[0].endsWith('.*'))) {
        if (projections[0] !== '*') {
            const qualifier = unquoteIdentifier(projections[0].slice(0, -2).trim()).toLowerCase()
            if (!allowedQualifiers.has(qualifier)) return { target: null, reason: 'The wildcard does not reference the source table.' }
        }
        return { target: { schema, table, columns: null }, reason: '' }
    }

    const columnPattern = new RegExp(`^(?:(${identifier})\\s*\\.\\s*)?(${identifier})$`)
    const columns: string[] = []
    for (const projection of projections) {
        const match = projection.match(columnPattern)
        if (!match) return { target: null, reason: 'Expressions and aliased columns are read-only.' }
        if (match[1] && !allowedQualifiers.has(unquoteIdentifier(match[1]).toLowerCase())) {
            return { target: null, reason: 'A selected column references another source.' }
        }
        columns.push(unquoteIdentifier(match[2]))
    }
    return { target: { schema, table, columns }, reason: '' }
}

export function validateEditableResult(
    target: EditableResultTarget,
    resultColumns: Column[],
    info: Pick<drivers.TableInfo, 'columns' | 'primaryKey'>,
): EditableResultResolution {
    const names = resultColumns.map(column => column.name)
    if (new Set(names).size !== names.length) return { target: null, reason: 'Duplicate result column names are read-only.' }
    if (target.columns && (target.columns.length !== names.length || target.columns.some((name, index) => name !== names[index]))) {
        return { target: null, reason: 'Result columns do not match the selected table columns.' }
    }
    const tableColumns = new Set((info.columns ?? []).map(column => column.name))
    if (names.some(name => !tableColumns.has(name))) return { target: null, reason: 'The result contains columns that do not belong to the source table.' }
    const missingKey = (info.primaryKey ?? []).find(name => !names.includes(name))
    if (!info.primaryKey?.length || missingKey) return { target: null, reason: missingKey ? `Primary key column ${missingKey} is not in the result.` : 'The source table has no unique row key.' }
    return { target, reason: '' }
}

export function editableCellInput(cell: Value | undefined): { null: boolean; text: string } {
    return !cell || cell.t === 'null' ? { null: true, text: '' } : { null: false, text: String(cell.v ?? '') }
}

const unsafeOriginalType = /json|blob|binary|bytea|geometry|geography|xml|image/i

export function originalResultValues(columns: Column[], row: Value[]): Record<string, { null: boolean; text: string }> {
    return Object.fromEntries(columns.flatMap((column, index) => {
        const cell = row[index]
        if (!cell || (cell.t !== 'null' && (cell.ref || unsafeOriginalType.test(column.typeName)))) return []
        return [[column.name, editableCellInput(cell)]]
    }))
}

export function buildResultRowChanges(columns: Column[], baseRows: Value[][], primaryKey: string[], edits: ResultCellEdit[]): EditableResultChange[] {
    const grouped = new Map<number, Record<string, { null: boolean; text: string }>>()
    edits.forEach(edit => {
        const column = columns[edit.columnIndex]
        if (!column) return
        const set = grouped.get(edit.rowIndex) ?? {}
        set[column.name] = edit.cell
        grouped.set(edit.rowIndex, set)
    })
    return [...grouped.entries()].map(([rowIndex, set]) => ({
        rowIndex,
        kind: 'update',
        key: Object.fromEntries(primaryKey.map(name => [name, editableCellInput(baseRows[rowIndex]?.[columns.findIndex(column => column.name === name)])])),
        set,
        original: originalResultValues(columns, baseRows[rowIndex] ?? []),
    }))
}

export function buildEditableResultChanges(
    columns: Column[],
    baseRows: Value[][],
    primaryKey: string[],
    edits: ResultCellEdit[],
    insertedRows: Set<number>,
    deletedRows: Set<number>,
): EditableResultChange[] {
    const updates = buildResultRowChanges(
        columns,
        baseRows,
        primaryKey,
        edits.filter(edit => !insertedRows.has(edit.rowIndex) && !deletedRows.has(edit.rowIndex)),
    )
    const byRow = new Map<number, ResultCellEdit[]>()
    edits.forEach(edit => byRow.set(edit.rowIndex, [...(byRow.get(edit.rowIndex) ?? []), edit]))
    const inserts = [...insertedRows].filter(rowIndex => !deletedRows.has(rowIndex)).map(rowIndex => ({
        rowIndex,
        kind: 'insert' as const,
        key: {},
        set: Object.fromEntries((byRow.get(rowIndex) ?? []).map(edit => [columns[edit.columnIndex].name, edit.cell])),
        original: {},
    }))
    const deletes = [...deletedRows].filter(rowIndex => !insertedRows.has(rowIndex)).map(rowIndex => ({
        rowIndex,
        kind: 'delete' as const,
        key: Object.fromEntries(primaryKey.map(name => [name, editableCellInput(baseRows[rowIndex]?.[columns.findIndex(column => column.name === name)])])),
        set: {},
        original: originalResultValues(columns, baseRows[rowIndex] ?? []),
    }))
    return [...updates, ...inserts, ...deletes]
}
