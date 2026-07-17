import { describe, expect, it } from 'vitest'
import { matchesShortcut } from './commands'

const keyEvent = (key: string, options: Partial<KeyboardEvent> = {}) =>
    ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...options }) as KeyboardEvent

describe('command shortcuts', () => {
    it('accepts either platform modifier', () => {
        expect(matchesShortcut(keyEvent('1', { metaKey: true }), 'Mod+1')).toBe(true)
        expect(matchesShortcut(keyEvent('1', { ctrlKey: true }), 'Mod+1')).toBe(true)
    })

    it('requires the declared modifier combination', () => {
        expect(matchesShortcut(keyEvent('p', { metaKey: true }), 'Mod+Shift+P')).toBe(false)
        expect(matchesShortcut(keyEvent('p', { metaKey: true, shiftKey: true }), 'Mod+Shift+P')).toBe(true)
    })
})
