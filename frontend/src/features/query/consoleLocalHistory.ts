const STORAGE_KEY = 'datagrid.console-local-history.v1'
const MAX_PER_CONSOLE = 60
const MAX_TOTAL_CHARS = 2_500_000

export type ConsoleRevisionReason = 'edit' | 'executed' | 'restore-point'

export interface ConsoleRevision {
    id: string
    tabId: string
    title: string
    sql: string
    createdAt: number
    reason: ConsoleRevisionReason
}

export interface DiffLine {
    kind: 'same' | 'added' | 'removed'
    text: string
    oldLine?: number
    newLine?: number
}

function loadAll(storage: Storage): ConsoleRevision[] {
    try {
        const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]') as unknown
        if (!Array.isArray(value)) return []
        return value.filter((item): item is ConsoleRevision =>
            typeof item?.id === 'string' &&
            typeof item?.tabId === 'string' &&
            typeof item?.title === 'string' &&
            typeof item?.sql === 'string' &&
            typeof item?.createdAt === 'number' &&
            ['edit', 'executed', 'restore-point'].includes(item?.reason),
        )
    } catch {
        return []
    }
}

function persist(revisions: ConsoleRevision[], storage: Storage) {
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(revisions))
    } catch {
        // Local history is best-effort; a full or unavailable storage backend
        // must never interrupt editing or query execution.
    }
}

export function loadConsoleRevisions(tabId: string, storage: Storage = window.localStorage): ConsoleRevision[] {
    return loadAll(storage).filter(revision => revision.tabId === tabId).sort((left, right) => right.createdAt - left.createdAt)
}

export function saveConsoleRevision(input: Omit<ConsoleRevision, 'id' | 'createdAt'> & { createdAt?: number }, storage: Storage = window.localStorage): ConsoleRevision {
    const createdAt = input.createdAt ?? Date.now()
    const revisions = loadAll(storage)
    const latest = revisions.filter(revision => revision.tabId === input.tabId).sort((left, right) => right.createdAt - left.createdAt)[0]
    if (latest?.sql === input.sql) {
        latest.createdAt = createdAt
        latest.title = input.title
        if (input.reason !== 'edit') latest.reason = input.reason
        persist(revisions, storage)
        return latest
    }

    const revision: ConsoleRevision = { ...input, createdAt, id: `${input.tabId}-${createdAt}-${Math.random().toString(36).slice(2, 7)}` }
    revisions.push(revision)
    let retained = revisions.sort((left, right) => right.createdAt - left.createdAt)
        .filter((item, index, all) => all.slice(0, index).filter(other => other.tabId === item.tabId).length < MAX_PER_CONSOLE)
    let size = 0
    retained = retained.filter(item => {
        size += item.sql.length
        return size <= MAX_TOTAL_CHARS || size === item.sql.length
    })
    persist(retained, storage)
    return revision
}

export function deleteConsoleRevision(id: string, storage: Storage = window.localStorage) {
    persist(loadAll(storage).filter(revision => revision.id !== id), storage)
}

export function clearConsoleRevisions(tabId: string, storage: Storage = window.localStorage) {
    persist(loadAll(storage).filter(revision => revision.tabId !== tabId), storage)
}

export function diffLines(before: string, after: string): DiffLine[] {
    const oldLines = before.split('\n')
    const newLines = after.split('\n')
    // Keep pathological generated scripts from allocating an enormous LCS
    // matrix. The aligned fallback is still readable and linear in size.
    if (oldLines.length * newLines.length > 250_000) {
        const result: DiffLine[] = []
        const length = Math.max(oldLines.length, newLines.length)
        for (let index = 0; index < length; index++) {
            if (oldLines[index] === newLines[index]) result.push({ kind: 'same', text: oldLines[index], oldLine: index + 1, newLine: index + 1 })
            else {
                if (oldLines[index] != null) result.push({ kind: 'removed', text: oldLines[index], oldLine: index + 1 })
                if (newLines[index] != null) result.push({ kind: 'added', text: newLines[index], newLine: index + 1 })
            }
        }
        return result
    }

    const matrix = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(newLines.length + 1))
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
        for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
            matrix[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
                ? matrix[oldIndex + 1][newIndex + 1] + 1
                : Math.max(matrix[oldIndex + 1][newIndex], matrix[oldIndex][newIndex + 1])
        }
    }
    const result: DiffLine[] = []
    let oldIndex = 0
    let newIndex = 0
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
        if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
            result.push({ kind: 'same', text: oldLines[oldIndex], oldLine: ++oldIndex, newLine: ++newIndex })
        } else if (newIndex < newLines.length && (oldIndex === oldLines.length || matrix[oldIndex][newIndex + 1] > matrix[oldIndex + 1][newIndex])) {
            result.push({ kind: 'added', text: newLines[newIndex], newLine: ++newIndex })
        } else {
            result.push({ kind: 'removed', text: oldLines[oldIndex], oldLine: ++oldIndex })
        }
    }
    return result
}
