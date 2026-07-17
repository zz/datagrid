const STORAGE_KEY = 'datagrid.consoles.v1'

export interface PersistedConsole {
    id: string
    connId: string
    title: string
    sql: string
}

export interface ConsoleSnapshot {
    consoles: PersistedConsole[]
    activeConsoleId: string | null
}

const emptySnapshot = (): ConsoleSnapshot => ({ consoles: [], activeConsoleId: null })

export function loadConsoleSnapshot(storage: Storage = window.localStorage): ConsoleSnapshot {
    try {
        const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as Partial<ConsoleSnapshot>
        const consoles = Array.isArray(value.consoles)
            ? value.consoles.filter(
                  console =>
                      typeof console?.id === 'string' &&
                      typeof console?.connId === 'string' &&
                      typeof console?.title === 'string' &&
                      typeof console?.sql === 'string',
              )
            : []
        const activeConsoleId = consoles.some(console => console.id === value.activeConsoleId)
            ? value.activeConsoleId!
            : consoles.at(-1)?.id ?? null
        return { consoles, activeConsoleId }
    } catch {
        return emptySnapshot()
    }
}

export function saveConsoleSnapshot(snapshot: ConsoleSnapshot, storage: Storage = window.localStorage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}
