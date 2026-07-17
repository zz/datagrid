import { describe, expect, it } from 'vitest'
import { loadTestDataPresets, saveTestDataPresets } from './testDataPresets'

class MemoryStorage implements Storage {
    private values = new Map<string, string>(); get length() { return this.values.size }
    clear() { this.values.clear() } getItem(key: string) { return this.values.get(key) ?? null }
    key(index: number) { return [...this.values.keys()][index] ?? null } removeItem(key: string) { this.values.delete(key) }
    setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('test data presets', () => {
    it('persists choices without sampled foreign-key values', () => {
        const storage = new MemoryStorage()
        saveTestDataPresets([{ id: 'one', name: 'One', configs: { user_id: { kind: 'foreign-key', values: ['1', '2'] } } }], storage)
        expect(loadTestDataPresets(storage)[0].configs.user_id).toEqual({ kind: 'foreign-key' })
    })
})
