import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerFavorite, useExplorer } from './explorer'

const favorite: ExplorerFavorite = { connId: 'pg', schema: 'public', kind: 'table', name: 'users' }

describe('explorer favorites', () => {
    beforeEach(() => {
        const values = new Map<string, string>()
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => values.set(key, value),
            },
        })
        useExplorer.setState({ favorites: [] })
    })

    it('adds, persists, and removes an object favorite', () => {
        useExplorer.getState().toggleFavorite(favorite)
        expect(useExplorer.getState().isFavorite(favorite)).toBe(true)
        expect(JSON.parse(window.localStorage.getItem('datagrid.explorer.v1') ?? '[]')).toEqual([favorite])

        useExplorer.getState().toggleFavorite(favorite)
        expect(useExplorer.getState().favorites).toEqual([])
    })
})
