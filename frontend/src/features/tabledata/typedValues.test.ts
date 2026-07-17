import { describe, expect, it } from 'vitest'
import { formatJson, fromTemporalInput, isBooleanColumn, isJsonColumn, normalizeTypedValue, temporalInputType, toTemporalInput } from './typedValues'

describe('typed table values', () => {
    it('classifies JSON and temporal types', () => {
        expect(isJsonColumn('jsonb', 'str')).toBe(true)
        expect(temporalInputType('date', 'time')).toBe('date')
        expect(temporalInputType('timestamp with time zone', 'time')).toBe('datetime-local')
        expect(isBooleanColumn('boolean', 'str')).toBe(true)
    })

    it('converts values for native temporal inputs', () => {
        expect(toTemporalInput('2026-07-11T12:34:56Z', 'datetime-local')).toBe('2026-07-11T12:34:56')
        expect(fromTemporalInput('2026-07-11T12:34', 'datetime-local')).toBe('2026-07-11 12:34')
    })

    it('formats valid JSON and rejects invalid JSON', () => {
        expect(formatJson('{"ok":true}')).toContain('\n')
        expect(() => formatJson('{bad')).toThrow()
    })

    it('normalizes pasted typed values and rejects invalid input', () => {
        expect(normalizeTypedValue('jsonb', 'json', '{ "ok": true }')).toEqual({ value: '{"ok":true}', error: '' })
        expect(normalizeTypedValue('boolean', 'bool', 'YES').value).toBe('true')
        expect(normalizeTypedValue('integer', 'str', '1.2').error).toContain('whole number')
        expect(normalizeTypedValue('time', 'str', '25:00').error).toContain('valid time')
        expect(normalizeTypedValue('date', 'time', '2026-02-29').error).toContain('valid date')
        expect(normalizeTypedValue('date', 'time', '2024-02-29').error).toBe('')
        expect(normalizeTypedValue('timestamp', 'time', '2026-04-31 12:30').error).toContain('valid date and time')
    })
})
