import { create } from 'zustand'

const STORAGE_KEY = 'datagrid.explorer.v1'

export interface ExplorerFavorite {
    connId: string
    schema: string
    kind: 'table' | 'view'
    name: string
}

interface ExplorerState {
    favorites: ExplorerFavorite[]
    toggleFavorite: (favorite: ExplorerFavorite) => void
    isFavorite: (favorite: ExplorerFavorite) => boolean
}

const favoriteKey = (favorite: ExplorerFavorite) =>
    `${favorite.connId}\u0000${favorite.schema}\u0000${favorite.kind}\u0000${favorite.name}`

function loadFavorites(): ExplorerFavorite[] {
    try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
        return Array.isArray(saved) ? saved : []
    } catch {
        return []
    }
}

function persist(favorites: ExplorerFavorite[]) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
}

export const useExplorer = create<ExplorerState>((set, get) => ({
    favorites: loadFavorites(),
    toggleFavorite: favorite => {
        const key = favoriteKey(favorite)
        const current = get().favorites
        const next = current.some(item => favoriteKey(item) === key)
            ? current.filter(item => favoriteKey(item) !== key)
            : [...current, favorite]
        set({ favorites: next })
        persist(next)
    },
    isFavorite: favorite => {
        const key = favoriteKey(favorite)
        return get().favorites.some(item => favoriteKey(item) === key)
    },
}))
