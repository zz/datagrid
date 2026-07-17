import { describe, expect, it } from 'vitest'
import { linePreview, loadSQLBookmarks, saveSQLBookmarks } from './sqlBookmarks'

class MemoryStorage implements Storage {
    private values = new Map<string, string>()
    get length() { return this.values.size }
    clear() { this.values.clear() }
    getItem(key: string) { return this.values.get(key) ?? null }
    key(index: number) { return [...this.values.keys()][index] ?? null }
    removeItem(key: string) { this.values.delete(key) }
    setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('SQL bookmarks', () => {
    it('persists unique sorted positive line numbers', () => {
        const storage = new MemoryStorage()
        saveSQLBookmarks({ tab: [4, 1, 4] }, storage)
        expect(loadSQLBookmarks(storage)).toEqual({ tab: [1, 4] })
    })
    it('renders a concise line preview', () => expect(linePreview('SELECT 1\n  FROM users  ', 2)).toBe('FROM users'))
})
