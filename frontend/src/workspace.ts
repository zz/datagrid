import { create } from 'zustand'

const STORAGE_KEY = 'datagrid.workspace.v1'

interface WorkspaceSnapshot {
    explorerOpen: boolean
    explorerWidth: number
    bottomPanelHeight: number
}

interface WorkspaceState extends WorkspaceSnapshot {
    setExplorerOpen: (open: boolean) => void
    setExplorerWidth: (width: number) => void
    setBottomPanelHeight: (height: number) => void
}

const defaults: WorkspaceSnapshot = {
    explorerOpen: true,
    explorerWidth: 280,
    bottomPanelHeight: 260,
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function loadWorkspace(): WorkspaceSnapshot {
    try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<WorkspaceSnapshot>
        return {
            explorerOpen: saved.explorerOpen ?? defaults.explorerOpen,
            explorerWidth: clamp(saved.explorerWidth ?? defaults.explorerWidth, 220, 520),
            bottomPanelHeight: clamp(saved.bottomPanelHeight ?? defaults.bottomPanelHeight, 140, 520),
        }
    } catch {
        return defaults
    }
}

function persist(snapshot: WorkspaceSnapshot) {
    window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            explorerOpen: snapshot.explorerOpen,
            explorerWidth: snapshot.explorerWidth,
            bottomPanelHeight: snapshot.bottomPanelHeight,
        }),
    )
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
    ...loadWorkspace(),
    setExplorerOpen: explorerOpen => {
        set({ explorerOpen })
        persist({ ...get(), explorerOpen })
    },
    setExplorerWidth: explorerWidth => {
        const width = clamp(explorerWidth, 220, 520)
        set({ explorerWidth: width })
        persist({ ...get(), explorerWidth: width })
    },
    setBottomPanelHeight: bottomPanelHeight => {
        const height = clamp(bottomPanelHeight, 140, 520)
        set({ bottomPanelHeight: height })
        persist({ ...get(), bottomPanelHeight: height })
    },
}))
