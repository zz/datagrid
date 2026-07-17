import { drivers } from '../../../wailsjs/go/models'
import { VirtualForeignKey } from './virtualForeignKeys'

export type DependencyDirection = 'outgoing' | 'incoming'

export interface DependencyEdge {
    id: string
    source: string
    target: string
    constraint: string
    sourceColumns: string[]
    targetColumns: string[]
    onUpdate: string
    onDelete: string
    virtualKeyId?: string
}

export interface DependencyPath {
    table: string
    depth: number
    edge: DependencyEdge
    path: string[]
}

export function qualifiedTable(schema: string, table: string) {
    return schema ? `${schema}.${table}` : table
}

export function dependencyEdges(tables: Record<string, drivers.TableInfo>, virtualKeys: VirtualForeignKey[] = []): DependencyEdge[] {
    const physical = Object.entries(tables).flatMap(([source, info]) => (info.foreignKeys ?? []).map(key => {
        const target = qualifiedTable(key.referencedSchema || info.schema, key.referencedTable)
        return {
            id: `${source}:${key.name}:${target}`,
            source,
            target,
            constraint: key.name,
            sourceColumns: key.columns ?? [],
            targetColumns: key.referencedColumns ?? [],
            onUpdate: key.onUpdate || '',
            onDelete: key.onDelete || '',
        }
    }))
    return [...physical, ...virtualKeys.map(key => ({
        id: `virtual:${key.id}`,
        source: key.source,
        target: key.target,
        constraint: key.name,
        sourceColumns: key.sourceColumns,
        targetColumns: key.targetColumns,
        onUpdate: '',
        onDelete: '',
        virtualKeyId: key.id,
    }))]
}

// Returns the shortest path to every reachable table. Tracking the best depth
// makes traversal cycle-safe while keeping the result useful as an impact list.
export function dependencyPaths(edges: DependencyEdge[], root: string, direction: DependencyDirection): DependencyPath[] {
    const adjacent = (table: string) => edges.filter(edge => direction === 'outgoing' ? edge.source === table : edge.target === table)
    const visited = new Map<string, number>([[root, 0]])
    const queue: Array<{ table: string; path: string[] }> = [{ table: root, path: [root] }]
    const result: DependencyPath[] = []

    while (queue.length) {
        const current = queue.shift()!
        for (const edge of adjacent(current.table)) {
            const table = direction === 'outgoing' ? edge.target : edge.source
            const depth = current.path.length
            const previousDepth = visited.get(table)
            if (previousDepth != null && previousDepth <= depth) continue
            const path = [...current.path, table]
            visited.set(table, depth)
            result.push({ table, depth, edge, path })
            queue.push({ table, path })
        }
    }

    return result.sort((left, right) => left.depth - right.depth || left.table.localeCompare(right.table))
}

export function impactLevel(path: DependencyPath): 'high' | 'medium' {
    return path.depth === 1 ? 'high' : 'medium'
}
