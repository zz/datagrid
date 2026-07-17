import { describe, expect, it } from 'vitest'
import { createResultFilterPreset, loadResultFilterPresets, saveResultFilterPresets } from './resultFilterPresets'

class MemoryStorage {
    private values = new Map<string, string>()
    get length() { return this.values.size }
    clear() { this.values.clear() }
    getItem(key: string) { return this.values.get(key) ?? null }
    key(index: number) { return [...this.values.keys()][index] ?? null }
    removeItem(key: string) { this.values.delete(key) }
    setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('result filter presets', () => {
    it('round trips schema-scoped filters', () => {
        const storage = new MemoryStorage()
        const preset = createResultFilterPreset('Recent', [{ column: 1, op: 'in', value: '', values: ['open', 'pending'], includeNull: true }], {
            conjunction: 'and', groups: [{ id: 'range', conjunction: 'and', filters: [{ column: 0, op: '>', value: '10' }] }],
        }, 42)
        saveResultFilterPresets('orders', [preset], storage)
        expect(loadResultFilterPresets('orders', storage)).toEqual([preset])
        expect(loadResultFilterPresets('users', storage)).toEqual([])
    })

    it('ignores malformed persisted data', () => {
        const storage = new MemoryStorage()
        storage.setItem('datagrid.result-filter-presets.v1:orders', JSON.stringify([{ id: 'bad', name: 'Bad', filters: [{ column: -1 }], createdAt: 1 }]))
        expect(loadResultFilterPresets('orders', storage)).toEqual([])
    })
})
