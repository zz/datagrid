import { drivers } from '../../../wailsjs/go/models'
import type { ColumnDraft } from './migration'

export interface ColumnDifference {
    name: string
    status: 'added' | 'removed' | 'changed'
    origin?: drivers.ColumnInfo
    target?: drivers.ColumnInfo
    details: string[]
}

export interface MetadataDifference {
    category: 'constraint' | 'index'
    name: string
    status: 'added' | 'removed' | 'changed'
    details: string[]
}

const sameColumns = (left: string[] = [], right: string[] = []) => left.join('\0') === right.join('\0')

export function compareMetadata(origin: drivers.TableInfo, target: drivers.TableInfo): MetadataDifference[] {
    const differences: MetadataDifference[] = []
    const compare = <T extends { name: string }>(category: MetadataDifference['category'], left: T[], right: T[], equal: (a: T, b: T) => boolean) => {
        const leftByName = new Map(left.map(item => [item.name, item]))
        const rightByName = new Map(right.map(item => [item.name, item]))
        left.forEach(item => {
            const other = rightByName.get(item.name)
            if (!other) differences.push({ category, name: item.name, status: 'added', details: [`Missing ${category} on target`] })
            else if (!equal(item, other)) differences.push({ category, name: item.name, status: 'changed', details: [`${category} definition differs`] })
        })
        right.forEach(item => {
            if (!leftByName.has(item.name)) differences.push({ category, name: item.name, status: 'removed', details: [`Extra ${category} on target`] })
        })
    }
    const foreignKey = (info: drivers.TableInfo, name: string) => (info.foreignKeys ?? []).find(key => key.name === name)
    const sameForeignKey = (name: string) => {
        const left = foreignKey(origin, name)
        const right = foreignKey(target, name)
        if (!left && !right) return true
        return !!left && !!right && left.referencedSchema === right.referencedSchema && left.referencedTable === right.referencedTable &&
            sameColumns(left.columns, right.columns) && sameColumns(left.referencedColumns, right.referencedColumns) &&
            left.onUpdate === right.onUpdate && left.onDelete === right.onDelete
    }
    compare('constraint', origin.constraints ?? [], target.constraints ?? [], (a, b) => a.kind === b.kind && sameColumns(a.columns, b.columns) && a.definition === b.definition && sameForeignKey(a.name))
    const standalone = (info: drivers.TableInfo) => (info.indexes ?? []).filter(index => index.name !== 'PRIMARY' && !(info.constraints ?? []).some(constraint => constraint.name === index.name))
    compare('index', standalone(origin), standalone(target), (a, b) => a.unique === b.unique && sameColumns(a.columns, b.columns))
    return differences
}

export function compareColumns(origin: drivers.ColumnInfo[], target: drivers.ColumnInfo[]): ColumnDifference[] {
    const originByName = new Map(origin.map(column => [column.name, column]))
    const targetByName = new Map(target.map(column => [column.name, column]))
    const differences: ColumnDifference[] = []
    for (const column of origin) {
        const other = targetByName.get(column.name)
        if (!other) {
            differences.push({ name: column.name, status: 'added', origin: column, details: ['Missing from target'] })
            continue
        }
        const details: string[] = []
        if (column.typeName !== other.typeName) details.push(`type ${other.typeName} → ${column.typeName}`)
        if (column.nullable !== other.nullable) details.push(column.nullable ? 'becomes nullable' : 'becomes NOT NULL')
        if (column.default !== other.default) details.push(`default ${other.default || 'none'} → ${column.default || 'none'}`)
        if (details.length) differences.push({ name: column.name, status: 'changed', origin: column, target: other, details })
    }
    for (const column of target) {
        if (!originByName.has(column.name)) differences.push({ name: column.name, status: 'removed', target: column, details: ['Not present in origin'] })
    }
    return differences
}

export function targetDrafts(origin: drivers.ColumnInfo[], target: drivers.ColumnInfo[]): ColumnDraft[] {
    const targetNames = new Set(target.map(column => column.name))
    return origin.map(column => ({
        originalName: targetNames.has(column.name) ? column.name : undefined,
        name: column.name,
        typeName: column.typeName,
        nullable: column.nullable,
        default: column.default,
    }))
}
