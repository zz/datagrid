import { drivers } from '../../../wailsjs/go/models'

export interface PlanSnapshot {
    id: string
    label: string
    mode: 'estimate' | 'actual'
    statement: string
    createdAt: number
    plan: drivers.PlanNode
}

export interface PlanMetrics {
    nodes: number
    totalCost?: number
    actualTime?: number
    estimatedRows?: number
    actualRows?: number
}

export interface PlanNodeChange {
    path: string
    status: 'added' | 'removed' | 'changed'
    before?: string
    after?: string
}

function numberFrom(detail: string | undefined, pattern: RegExp): number | undefined {
    const value = pattern.exec(detail ?? '')?.[1]
    return value == null ? undefined : Number(value)
}

export function planMetrics(plan: drivers.PlanNode): PlanMetrics {
    const nodes: drivers.PlanNode[] = []
    const visit = (node: drivers.PlanNode) => { nodes.push(node); node.children?.forEach(visit) }
    visit(plan)
    const root = plan.detail
    return {
        nodes: nodes.length,
        totalCost: numberFrom(root, /cost=[\d.]+\.\.([\d.]+)/i),
        actualTime: numberFrom(root, /actual time=([\d.]+)/i),
        estimatedRows: numberFrom(root, /(?:^|\s)rows=([\d.]+)/i),
        actualRows: numberFrom(root, /actual rows=([\d.]+)/i),
    }
}

function flattened(plan: drivers.PlanNode): Map<string, string> {
    const output = new Map<string, string>()
    const visit = (node: drivers.PlanNode, path: string) => {
        output.set(path, `${node.label}\n${node.detail ?? ''}`)
        node.children?.forEach((child, index) => visit(child, `${path}.${index + 1}`))
    }
    visit(plan, '1')
    return output
}

export function comparePlans(before: drivers.PlanNode, after: drivers.PlanNode): PlanNodeChange[] {
    const left = flattened(before)
    const right = flattened(after)
    const changes: PlanNodeChange[] = []
    for (const path of [...new Set([...left.keys(), ...right.keys()])].sort()) {
        const previous = left.get(path)
        const next = right.get(path)
        if (previous === next) continue
        if (previous == null) changes.push({ path, status: 'added', after: next })
        else if (next == null) changes.push({ path, status: 'removed', before: previous })
        else changes.push({ path, status: 'changed', before: previous, after: next })
    }
    return changes
}

export function metricDelta(before?: number, after?: number): string {
    if (before == null || after == null) return 'n/a'
    const delta = after - before
    return `${delta > 0 ? '+' : ''}${Number(delta.toFixed(3))}`
}
