import type { LucideIcon } from 'lucide-react'
import {
    Clock3,
    Database,
    FilePlus2,
    PanelLeft,
    Search,
    Settings,
    SlidersHorizontal,
} from 'lucide-react'

export interface WorkbenchCommand {
    id: string
    label: string
    category: 'Database' | 'Navigate' | 'View' | 'Settings'
    icon: LucideIcon
    shortcut?: string
    enabled: boolean
    run: () => void
}

interface CommandContext {
    explorerOpen: boolean
    historyOpen: boolean
    canOpenConsole: boolean
    toggleExplorer: () => void
    toggleHistory: () => void
    openConnections: () => void
    openNewConnection: () => void
    openConsole: () => void
    openGoTo: () => void
    openSettings: () => void
}

export function createWorkbenchCommands(context: CommandContext): WorkbenchCommand[] {
    return [
        {
            id: 'view.database-explorer',
            label: `${context.explorerOpen ? 'Hide' : 'Show'} Database Explorer`,
            category: 'View',
            icon: PanelLeft,
            shortcut: 'Mod+1',
            enabled: true,
            run: context.toggleExplorer,
        },
        {
            id: 'view.query-history',
            label: `${context.historyOpen ? 'Hide' : 'Show'} Query History`,
            category: 'View',
            icon: Clock3,
            shortcut: 'Mod+2',
            enabled: true,
            run: context.toggleHistory,
        },
        {
            id: 'navigate.table',
            label: 'Go to Table',
            category: 'Navigate',
            icon: Search,
            shortcut: 'Mod+P',
            enabled: true,
            run: context.openGoTo,
        },
        {
            id: 'database.console',
            label: 'New Query Console',
            category: 'Database',
            icon: FilePlus2,
            shortcut: 'Mod+N',
            enabled: context.canOpenConsole,
            run: context.openConsole,
        },
        {
            id: 'database.connections',
            label: 'Data Sources and Drivers',
            category: 'Database',
            icon: Database,
            enabled: true,
            run: context.openConnections,
        },
        {
            id: 'database.new-connection',
            label: 'New Data Source',
            category: 'Database',
            icon: SlidersHorizontal,
            shortcut: 'Mod+Shift+N',
            enabled: true,
            run: context.openNewConnection,
        },
        {
            id: 'settings.open',
            label: 'Settings',
            category: 'Settings',
            icon: Settings,
            shortcut: 'Mod+,',
            enabled: true,
            run: context.openSettings,
        },
    ]
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
    const parts = shortcut.toLowerCase().split('+')
    const key = parts.at(-1)
    return (
        event.key.toLowerCase() === key &&
        (event.metaKey || event.ctrlKey) === parts.includes('mod') &&
        event.shiftKey === parts.includes('shift') &&
        event.altKey === parts.includes('alt')
    )
}

export function displayShortcut(shortcut?: string): string {
    if (!shortcut) return ''
    const mac = navigator.platform.toLowerCase().includes('mac')
    return shortcut
        .replace('Mod', mac ? '⌘' : 'Ctrl')
        .replace('Shift', mac ? '⇧' : 'Shift')
        .replaceAll('+', mac ? '' : '+')
}
