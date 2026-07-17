export interface ResultColumnLayout {
    order: string[]
    hidden: string[]
    frozen: number
}

export function resultColumnIds(columns: Array<{ name: string }>): string[] {
    const counts = new Map<string, number>()
    return columns.map(column => {
        const occurrence = counts.get(column.name) ?? 0
        counts.set(column.name, occurrence + 1)
        return `${encodeURIComponent(column.name)}#${occurrence}`
    })
}

export function resultColumnLayoutKey(connId: string, columns: Array<{ name: string; typeName: string }>): string {
    const ids = resultColumnIds(columns)
    return `datagrid.result-columns:${connId}:${columns.map((column, index) => `${ids[index]}:${column.typeName}`).join('|')}`
}

export function normalizeResultColumnLayout(layout: Partial<ResultColumnLayout> | null | undefined, columns: string[]): ResultColumnLayout {
    const valid = new Set(columns)
    const savedOrder = Array.isArray(layout?.order) ? layout.order : []
    const savedHidden = Array.isArray(layout?.hidden) ? layout.hidden : []
    const order = [...new Set([...savedOrder.filter(name => valid.has(name)), ...columns])]
    let hidden = [...new Set(savedHidden.filter(name => valid.has(name)))]
    if (hidden.length >= columns.length) hidden = hidden.slice(0, Math.max(0, columns.length - 1))
    const visibleCount = columns.length - hidden.length
    const savedFrozen = layout?.frozen
    const requestedFrozen = typeof savedFrozen === 'number' && Number.isFinite(savedFrozen) ? Math.floor(savedFrozen) : 0
    return { order, hidden, frozen: Math.max(0, Math.min(visibleCount, requestedFrozen)) }
}

export function resultVisibleColumnIndexes(layout: ResultColumnLayout, columns: string[]): number[] {
    const hidden = new Set(layout.hidden)
    return layout.order.filter(id => !hidden.has(id)).map(id => columns.indexOf(id)).filter(index => index >= 0)
}

export function moveResultColumn(layout: ResultColumnLayout, startIndex: number, endIndex: number): ResultColumnLayout {
    const hidden = new Set(layout.hidden)
    const visible = layout.order.filter(name => !hidden.has(name))
    if (startIndex < 0 || endIndex < 0 || startIndex >= visible.length || endIndex >= visible.length || startIndex === endIndex) return layout
    const [moved] = visible.splice(startIndex, 1)
    visible.splice(endIndex, 0, moved)
    return { ...layout, order: [...visible, ...layout.order.filter(name => hidden.has(name))] }
}

export function moveResultColumnId(layout: ResultColumnLayout, id: string, direction: -1 | 1): ResultColumnLayout {
    const hidden = new Set(layout.hidden)
    const visibleOrder = layout.order.filter(column => !hidden.has(column))
    const hiddenOrder = layout.order.filter(column => hidden.has(column))
    const order = hidden.has(id) ? hiddenOrder : visibleOrder
    const index = order.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= order.length) return layout
    ;[order[index], order[target]] = [order[target], order[index]]
    return { ...layout, order: [...visibleOrder, ...hiddenOrder] }
}

export function toggleResultColumnPinned(layout: ResultColumnLayout, id: string): ResultColumnLayout {
    if (layout.hidden.includes(id)) return layout
    const visible = layout.order.filter(column => !layout.hidden.includes(column))
    const index = visible.indexOf(id)
    if (index < 0) return layout
    if (index < layout.frozen) return { ...layout, frozen: index }
    const [column] = visible.splice(index, 1)
    visible.splice(layout.frozen, 0, column)
    return { ...layout, order: [...visible, ...layout.order.filter(columnId => layout.hidden.includes(columnId))], frozen: layout.frozen + 1 }
}

export function setResultColumnsVisible(layout: ResultColumnLayout, ids: string[], visible: boolean): ResultColumnLayout {
    const targets = new Set(ids)
    const hidden = visible
        ? layout.hidden.filter(id => !targets.has(id))
        : [...new Set([...layout.hidden, ...layout.order.filter(id => targets.has(id))])]
    if (hidden.length >= layout.order.length) hidden.splice(hidden.indexOf(layout.order[0]), 1)
    return { ...layout, hidden, frozen: Math.min(layout.frozen, layout.order.length - hidden.length) }
}

export function setResultColumnsPinned(layout: ResultColumnLayout, ids: string[], pinned: boolean): ResultColumnLayout {
    const targets = new Set(ids)
    const hidden = new Set(layout.hidden)
    const visible = layout.order.filter(id => !hidden.has(id))
    const pinnedColumns = visible.slice(0, layout.frozen)
    const unpinnedColumns = visible.slice(layout.frozen)
    const nextPinned = pinned
        ? [...pinnedColumns, ...unpinnedColumns.filter(id => targets.has(id))]
        : pinnedColumns.filter(id => !targets.has(id))
    const nextUnpinned = pinned
        ? unpinnedColumns.filter(id => !targets.has(id))
        : [...pinnedColumns.filter(id => targets.has(id)), ...unpinnedColumns]
    return { ...layout, order: [...nextPinned, ...nextUnpinned, ...layout.order.filter(id => hidden.has(id))], frozen: nextPinned.length }
}

export function loadResultColumnLayout(key: string, storage: Storage = window.localStorage): Partial<ResultColumnLayout> | null {
    try { return JSON.parse(storage.getItem(key) ?? 'null') } catch { return null }
}

export function saveResultColumnLayout(key: string, layout: ResultColumnLayout, storage: Storage = window.localStorage) {
    try { storage.setItem(key, JSON.stringify(layout)) } catch { /* Layout persistence must not break the grid. */ }
}
