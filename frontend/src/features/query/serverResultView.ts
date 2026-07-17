import type { Column } from '../../ipc/types'
import { resultViewSorts, withoutResultFilterExpressionColumn } from './resultProcessing'
import type { DistinctColumnValue, ResultFilter, ResultFilterExpression, ResultViewState } from './resultProcessing'

export type ResultServerView = ResultViewState

export interface ResultFacetRequest {
    view: ResultServerView
    column: number
    search: string
}

export interface ResultFacetResult {
    values: DistinctColumnValue[]
    limited: boolean
}

export const RESULT_VIEW_MARKER = 'datagrid:result-view'

export function buildServerResultCountStatement(statement: string): string | null {
    const source = statement.trim().replace(/;+\s*$/, '')
    return source ? `SELECT COUNT(*) AS datagrid_count FROM (${source}) AS datagrid_count_source` : null
}

export function canBuildServerResultView(columns: Column[]): boolean {
    const names = columns.map(column => column.name.trim().toLowerCase())
    return names.length > 0 && names.every(Boolean) && new Set(names).size === names.length
}

const quoteIdentifier = (value: string, engine: string) => engine === 'mysql'
    ? `\`${value.replaceAll('`', '``')}\``
    : `"${value.replaceAll('"', '""')}"`

// Quoted literals retain text values such as leading-zero identifiers while
// PostgreSQL and MySQL still coerce them through the compared column's type.
const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`

const textExpression = (identifier: string, engine: string) => engine === 'mysql'
    ? `LOWER(CAST(${identifier} AS CHAR))`
    : `LOWER(CAST(${identifier} AS TEXT))`

function serverFilterPredicate(filter: ResultFilter, columns: Column[], engine: string): string | null {
    const column = columns[filter.column]
    if (!column) return null
    const identifier = quoteIdentifier(column.name, engine)
    if (filter.op === 'is null') return `${identifier} IS NULL`
    if (filter.op === 'is not null') return `${identifier} IS NOT NULL`
    if (filter.op === 'in') {
        const values = filter.values ?? []
        const parts: string[] = []
        if (values.length) parts.push(`${identifier} IN (${values.map(sqlLiteral).join(', ')})`)
        if (filter.includeNull) parts.push(`${identifier} IS NULL`)
        return parts.length ? `(${parts.join(' OR ')})` : '1 = 0'
    }
    if (filter.op === 'contains' || filter.op === 'starts') {
        const escaped = filter.value.toLowerCase().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_').replaceAll("'", "''")
        return `${textExpression(identifier, engine)} LIKE '${filter.op === 'contains' ? '%' : ''}${escaped}%' ESCAPE '\\\\'`
    }
    if (!['=', '!=', '<', '>', '<=', '>='].includes(filter.op)) return null
    return `${identifier} ${filter.op === '!=' ? '<>' : filter.op} ${sqlLiteral(filter.value)}`
}

function serverExpressionPredicate(expression: ResultFilterExpression | null | undefined, columns: Column[], engine: string): string | null {
    if (!expression?.groups.length) return null
    const groups = expression.groups.flatMap(group => {
        const rules = group.filters.flatMap(filter => {
            const predicate = serverFilterPredicate(filter, columns, engine)
            return predicate ? [predicate] : []
        })
        return rules.length ? [`(${rules.join(` ${group.conjunction.toUpperCase()} `)})`] : []
    })
    return groups.length ? `(${groups.join(` ${expression.conjunction.toUpperCase()} `)})` : null
}

export function buildServerFilterWhere(columns: Column[], filters: ResultFilter[], expression: ResultFilterExpression | null | undefined, engine: string): string {
    const predicates = filters.flatMap(filter => {
        const predicate = serverFilterPredicate(filter, columns, engine)
        return predicate ? [predicate] : []
    })
    const advanced = serverExpressionPredicate(expression, columns, engine)
    if (advanced) predicates.push(advanced)
    return predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''
}

export function buildServerResultStatement(baseStatement: string, columns: Column[], view: ResultServerView, engine: string): string | null {
    if (!canBuildServerResultView(columns)) return null
    const base = baseStatement.trim().replace(/;+\s*$/, '')
    if (!base) return null
    const filterWhere = buildServerFilterWhere(columns, view.filters, view.expression, engine)
    const predicates = filterWhere ? [filterWhere.slice('WHERE '.length)] : []
    const search = view.search.trim().toLowerCase()
    if (search) {
        const escaped = search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_').replaceAll("'", "''")
        predicates.push(`(${columns.map(column => `${textExpression(quoteIdentifier(column.name, engine), engine)} LIKE '%${escaped}%' ESCAPE '\\\\'`).join(' OR ')})`)
    }
    const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : ''
    const orderColumns = resultViewSorts(view).filter(sort => columns[sort.column])
    const order = orderColumns.length ? ` ORDER BY ${orderColumns.map(sort => `${quoteIdentifier(columns[sort.column].name, engine)} ${sort.descending ? 'DESC' : 'ASC'}`).join(', ')}` : ''
    if (!where && !order) return base
    return `SELECT /* ${RESULT_VIEW_MARKER} */ * FROM (${base}) AS datagrid_result${where}${order}`
}

export function buildServerFacetStatement(baseStatement: string, columns: Column[], view: ResultServerView, facetColumn: number, engine: string, search = '', limit = 501): string | null {
    const column = columns[facetColumn]
    if (!column || !canBuildServerResultView(columns) || !Number.isInteger(limit) || limit < 1 || limit > 1000) return null
    if (/\b(json|bytea|blob|binary|geometry|geography)\b/i.test(column.typeName)) return null
    const source = buildServerResultStatement(baseStatement, columns, {
        ...view,
        filters: view.filters.filter(filter => filter.column !== facetColumn),
        expression: withoutResultFilterExpressionColumn(view.expression, facetColumn),
        sort: null,
        sorts: [],
    }, engine)
    if (!source) return null
    const identifier = quoteIdentifier(column.name, engine)
    const needle = search.trim().toLowerCase()
    let where = ''
    if (needle) {
        const escaped = needle.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_').replaceAll("'", "''")
        const matchesNull = 'null'.includes(needle)
        where = ` WHERE (${textExpression(identifier, engine)} LIKE '%${escaped}%' ESCAPE '\\\\'${matchesNull ? ` OR ${identifier} IS NULL` : ''})`
    }
    return `SELECT ${identifier} AS datagrid_value, COUNT(*) AS datagrid_count FROM (${source}) AS datagrid_facet${where} GROUP BY ${identifier} ORDER BY ${textExpression(identifier, engine)} ASC LIMIT ${limit}`
}
