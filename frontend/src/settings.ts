import { create } from 'zustand'

export type Theme = 'system' | 'light' | 'dark'

interface SettingsState {
    theme: Theme
    pageSize: number // table-data rows per page
    rowLimit: number // query result cap
    update: (patch: Partial<Pick<SettingsState, 'theme' | 'pageSize' | 'rowLimit'>>) => void
}

const KEY = 'datagrid.settings'
const DEFAULTS = { theme: 'system' as Theme, pageSize: 200, rowLimit: 10000 }

function load() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
    } catch {
        return { ...DEFAULTS }
    }
}

// applyTheme sets an explicit theme override; 'system' falls back to the OS
// preference (the CSS media query).
export function applyTheme(theme: Theme) {
    const el = document.documentElement
    if (theme === 'system') delete el.dataset.theme
    else el.dataset.theme = theme
}

export const useSettings = create<SettingsState>((set, get) => ({
    ...load(),
    update: patch => {
        const next = { ...get(), ...patch }
        localStorage.setItem(KEY, JSON.stringify({ theme: next.theme, pageSize: next.pageSize, rowLimit: next.rowLimit }))
        if (patch.theme) applyTheme(patch.theme)
        set(patch)
    },
}))

// Non-hook accessors so the store/actions can read current settings.
export const pageSize = () => useSettings.getState().pageSize
export const rowLimit = () => useSettings.getState().rowLimit
