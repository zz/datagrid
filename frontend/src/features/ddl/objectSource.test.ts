import { describe, expect, it } from 'vitest'
import { sourceChangeSummary } from './objectSource'

describe('object source changes', () => {
    it('summarizes changed, added, and removed lines', () => {
        expect(sourceChangeSummary('one\ntwo', 'one\nchanged\nthree')).toEqual({ changed: 1, added: 1, removed: 0 })
        expect(sourceChangeSummary('one\ntwo\nthree', 'one')).toEqual({ changed: 0, added: 0, removed: 2 })
    })
})
