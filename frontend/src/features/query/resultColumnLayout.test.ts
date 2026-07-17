import { describe, expect, it } from 'vitest'
import { loadResultColumnLayout, moveResultColumn, moveResultColumnId, normalizeResultColumnLayout, resultColumnIds, resultColumnLayoutKey, resultVisibleColumnIndexes, saveResultColumnLayout, setResultColumnsPinned, setResultColumnsVisible, toggleResultColumnPinned } from './resultColumnLayout'

describe('result column layout', () => {
    it('reconciles saved layouts with the current result schema', () => {
        expect(normalizeResultColumnLayout({ order: ['email', 'missing'], hidden: ['id', 'email'], frozen: 9 }, ['id', 'email'])).toEqual({
            order: ['email', 'id'], hidden: ['id'], frozen: 1,
        })
        expect(normalizeResultColumnLayout({ order: 'bad' as unknown as string[], hidden: [], frozen: Number.NaN }, ['id'])).toEqual({ order: ['id'], hidden: [], frozen: 0 })
    })

    it('moves visible columns without losing hidden columns', () => {
        expect(moveResultColumn({ order: ['id', 'secret', 'name'], hidden: ['secret'], frozen: 1 }, 1, 0).order).toEqual(['name', 'id', 'secret'])
    })

    it('builds stable schema keys for duplicate column names', () => {
        const columns = [{ name: 'id', typeName: 'integer' }, { name: 'id', typeName: 'text' }]
        expect(resultColumnIds(columns)).toEqual(['id#0', 'id#1'])
        expect(resultColumnLayoutKey('main', columns)).toBe('datagrid.result-columns:main:id#0:integer|id#1:text')
    })

    it('resolves visible indexes in persisted order', () => {
        const ids = resultColumnIds([{ name: 'id' }, { name: 'name' }, { name: 'id' }])
        expect(resultVisibleColumnIndexes({ order: ['id#1', 'name#0', 'id#0'], hidden: ['name#0'], frozen: 1 }, ids)).toEqual([2, 0])
    })

    it('reorders within visibility groups and manages the pinned prefix', () => {
        const layout = { order: ['id', 'name', 'secret'], hidden: ['secret'], frozen: 1 }
        expect(moveResultColumnId(layout, 'name', -1).order).toEqual(['name', 'id', 'secret'])
        const pinned = toggleResultColumnPinned(layout, 'name')
        expect(pinned).toEqual({ order: ['id', 'name', 'secret'], hidden: ['secret'], frozen: 2 })
        expect(toggleResultColumnPinned(pinned, 'name').frozen).toBe(1)
        expect(toggleResultColumnPinned(layout, 'secret')).toBe(layout)
    })

    it('applies bulk visibility without hiding every column', () => {
        const layout = { order: ['id', 'name', 'email'], hidden: ['email'], frozen: 2 }
        expect(setResultColumnsVisible(layout, ['name', 'email'], false)).toEqual({ order: layout.order, hidden: ['email', 'name'], frozen: 1 })
        expect(setResultColumnsVisible(layout, ['id', 'name', 'email'], false).hidden).toEqual(['email', 'name'])
        expect(setResultColumnsVisible(layout, ['email'], true).hidden).toEqual([])
    })

    it('pins and unpins matched columns as a leading group', () => {
        const layout = { order: ['id', 'name', 'email', 'secret'], hidden: ['secret'], frozen: 1 }
        const pinned = setResultColumnsPinned(layout, ['email'], true)
        expect(pinned).toEqual({ order: ['id', 'email', 'name', 'secret'], hidden: ['secret'], frozen: 2 })
        expect(setResultColumnsPinned(pinned, ['id'], false)).toEqual({ order: ['email', 'id', 'name', 'secret'], hidden: ['secret'], frozen: 1 })
    })

    it('persists layouts', () => {
        const storage = new Map<string, string>()
        const adapter: Storage = {
            get length() { return storage.size },
            clear: () => storage.clear(),
            getItem: key => storage.get(key) ?? null,
            key: index => [...storage.keys()][index] ?? null,
            removeItem: key => { storage.delete(key) },
            setItem: (key, value) => { storage.set(key, value) },
        }
        const layout = { order: ['name', 'id'], hidden: ['id'], frozen: 1 }
        saveResultColumnLayout('layout', layout, adapter)
        expect(loadResultColumnLayout('layout', adapter)).toEqual(layout)
    })
})
