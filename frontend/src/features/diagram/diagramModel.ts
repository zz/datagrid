import { drivers } from '../../../wailsjs/go/models'
import { VirtualForeignKey } from './virtualForeignKeys'

export interface DiagramPosition { x: number; y: number }
export interface DiagramEdge {
    id: string
    source: string
    target: string
    label: string
    virtual?: boolean
}

export function layoutTables(names: string[], columns = 3): Record<string, DiagramPosition> {
    return Object.fromEntries(names.map((name, index) => [name, {
        x: 36 + (index % columns) * 310,
        y: 36 + Math.floor(index / columns) * 300,
    }]))
}

export function diagramEdges(tables: Record<string, drivers.TableInfo>, virtualKeys: VirtualForeignKey[] = []): DiagramEdge[] {
    const available = new Set(Object.keys(tables))
    return Object.entries(tables).flatMap(([source, info]) => (info.foreignKeys ?? []).flatMap(key => {
        const target = `${key.referencedSchema || info.schema}.${key.referencedTable}`
        if (!available.has(target)) return []
        return [{
            id: `${source}:${key.name}:${target}`,
            source,
            target,
            label: key.columns.map((column, index) => `${column} -> ${key.referencedColumns[index] ?? '?'}`).join(', '),
        }]
    })).concat(virtualKeys.flatMap(key => available.has(key.source) && available.has(key.target) ? [{
        id: `virtual:${key.id}`,
        source: key.source,
        target: key.target,
        label: `${key.sourceColumns.map((column, index) => `${column} -> ${key.targetColumns[index] ?? '?'}`).join(', ')} (virtual)`,
        virtual: true,
    }] : []))
}
