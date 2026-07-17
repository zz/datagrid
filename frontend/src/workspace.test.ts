import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspace } from './workspace'

describe('workspace state', () => {
    beforeEach(() => {
        const values = new Map<string, string>()
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                clear: () => values.clear(),
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => values.set(key, value),
                removeItem: (key: string) => values.delete(key),
            },
        })
        useWorkspace.setState({ explorerOpen: true, explorerWidth: 280, bottomPanelHeight: 260 })
    })

    it('persists tool-window visibility and dimensions', () => {
        const state = useWorkspace.getState()
        state.setExplorerOpen(false)
        state.setExplorerWidth(360)
        state.setBottomPanelHeight(320)

        expect(JSON.parse(window.localStorage.getItem('datagrid.workspace.v1') ?? '{}')).toEqual({
            explorerOpen: false,
            explorerWidth: 360,
            bottomPanelHeight: 320,
        })
    })

    it('keeps resized panels within usable bounds', () => {
        useWorkspace.getState().setExplorerWidth(50)
        useWorkspace.getState().setBottomPanelHeight(900)

        expect(useWorkspace.getState().explorerWidth).toBe(220)
        expect(useWorkspace.getState().bottomPanelHeight).toBe(520)
    })
})
