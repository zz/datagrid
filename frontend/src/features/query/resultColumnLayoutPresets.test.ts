import { describe, expect, it } from 'vitest'
import { createResultColumnLayoutPreset, loadResultColumnLayoutPresets, saveResultColumnLayoutPresets } from './resultColumnLayoutPresets'

class MemoryStorage {
    private values = new Map<string, string>()
    get length() { return this.values.size }
    clear() { this.values.clear() }
    getItem(key: string) { return this.values.get(key) ?? null }
    key(index: number) { return [...this.values.keys()][index] ?? null }
    removeItem(key: string) { this.values.delete(key) }
    setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('result column layout presets', () => {
    it('round trips cloned schema-scoped layouts', () => {
        const storage = new MemoryStorage()
        const layout = { order: ['name', 'id'], hidden: ['id'], frozen: 1 }
        const preset = createResultColumnLayoutPreset('Review', layout, 42)
        layout.order.reverse()
        saveResultColumnLayoutPresets('orders', [preset], storage)
        expect(loadResultColumnLayoutPresets('orders', storage)).toEqual([preset])
        expect(loadResultColumnLayoutPresets('users', storage)).toEqual([])
        expect(preset.layout.order).toEqual(['name', 'id'])
    })

    it('ignores malformed persisted layouts', () => {
        const storage = new MemoryStorage()
        storage.setItem('datagrid.result-column-layout-presets.v1:orders', JSON.stringify([{ id: 'bad', name: 'Bad', layout: { order: 'id' }, createdAt: 1 }]))
        expect(loadResultColumnLayoutPresets('orders', storage)).toEqual([])
    })
})
