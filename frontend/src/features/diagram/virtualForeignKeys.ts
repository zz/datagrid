const STORAGE_KEY = 'datagrid.virtual-foreign-keys.v1'

export interface VirtualForeignKey {
    id: string
    connId: string
    name: string
    source: string
    target: string
    sourceColumns: string[]
    targetColumns: string[]
    createdAt: number
}

function valid(item: unknown): item is VirtualForeignKey {
    if (!item || typeof item !== 'object') return false
    const value = item as Partial<VirtualForeignKey>
    return typeof value.id === 'string' && typeof value.connId === 'string' && typeof value.name === 'string' &&
        typeof value.source === 'string' && typeof value.target === 'string' && Array.isArray(value.sourceColumns) &&
        value.sourceColumns.every(column => typeof column === 'string') && Array.isArray(value.targetColumns) &&
        value.targetColumns.every(column => typeof column === 'string') && value.sourceColumns.length === value.targetColumns.length &&
        value.sourceColumns.length > 0 && typeof value.createdAt === 'number'
}

function loadAll(storage: Storage): VirtualForeignKey[] {
    try {
        const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]') as unknown
        return Array.isArray(value) ? value.filter(valid) : []
    } catch {
        return []
    }
}

function persist(keys: VirtualForeignKey[], storage: Storage) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(keys)) } catch { /* optional local metadata */ }
}

export function loadVirtualForeignKeys(connId: string, storage: Storage = window.localStorage): VirtualForeignKey[] {
    return loadAll(storage).filter(key => key.connId === connId).sort((left, right) => left.name.localeCompare(right.name))
}

export function saveVirtualForeignKey(input: Omit<VirtualForeignKey, 'id' | 'createdAt'>, storage: Storage = window.localStorage): VirtualForeignKey {
    if (!input.name.trim()) throw new Error('Relationship name is required')
    if (!input.source || !input.target) throw new Error('Source and referenced tables are required')
    if (!input.sourceColumns.length || input.sourceColumns.length !== input.targetColumns.length || input.sourceColumns.some(column => !column) || input.targetColumns.some(column => !column)) throw new Error('Every source column must have a referenced column')
    const keys = loadAll(storage)
    if (keys.some(key => key.connId === input.connId && key.name.toLowerCase() === input.name.trim().toLowerCase())) throw new Error('A virtual relationship with this name already exists')
    const createdAt = Date.now()
    const key: VirtualForeignKey = { ...input, name: input.name.trim(), id: `vfk-${createdAt}-${Math.random().toString(36).slice(2, 8)}`, createdAt }
    persist([...keys, key], storage)
    return key
}

export function deleteVirtualForeignKey(id: string, storage: Storage = window.localStorage) {
    persist(loadAll(storage).filter(key => key.id !== id), storage)
}
