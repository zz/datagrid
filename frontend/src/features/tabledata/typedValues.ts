export type TemporalInputType = 'date' | 'time' | 'datetime-local'

export function isJsonColumn(typeName: string, valueTag: string): boolean {
    return valueTag === 'json' || /\bjsonb?\b/i.test(typeName)
}

export function isBooleanColumn(typeName: string, valueTag: string): boolean {
    return valueTag === 'bool' || /\bbool(?:ean)?\b/i.test(typeName)
}

export function temporalInputType(typeName: string, valueTag: string): TemporalInputType | null {
    const type = typeName.toLowerCase()
    if (type === 'date') return 'date'
    if (type.startsWith('time') && !type.startsWith('timestamp')) return 'time'
    if (valueTag === 'time' || /timestamp|datetime/.test(type)) return 'datetime-local'
    return null
}

export function toTemporalInput(value: string, type: TemporalInputType): string {
    if (type === 'date') return value.slice(0, 10)
    if (type === 'time') return value.match(/\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/)?.[0] ?? value
    return value.replace(' ', 'T').replace(/Z$|[+-]\d{2}:?\d{2}$/, '').slice(0, 23)
}

export function fromTemporalInput(value: string, type: TemporalInputType): string {
    if (type === 'datetime-local') return value.replace('T', ' ')
    return value
}

export function formatJson(value: string): string {
    return JSON.stringify(JSON.parse(value), null, 2)
}

function isValidDateParts(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1) return false
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return day <= daysInMonth[month - 1]
}

function isValidClockParts(hour: number, minute: number, second = 0): boolean {
    return hour <= 23 && minute <= 59 && second <= 59
}

export function normalizeTypedValue(typeName: string, valueTag: string, value: string): { value: string; error: string } {
    const trimmed = value.trim()
    if (isJsonColumn(typeName, valueTag)) {
        try { return { value: JSON.stringify(JSON.parse(value)), error: '' } } catch { return { value, error: 'Enter valid JSON.' } }
    }
    if (isBooleanColumn(typeName, valueTag)) {
        const normalized = trimmed.toLowerCase()
        if (['true', '1', 't', 'yes', 'y'].includes(normalized)) return { value: 'true', error: '' }
        if (['false', '0', 'f', 'no', 'n'].includes(normalized)) return { value: 'false', error: '' }
        return { value, error: 'Enter true or false.' }
    }
    const temporal = temporalInputType(typeName, valueTag)
    if (temporal === 'date') {
        const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (!match || !isValidDateParts(Number(match[1]), Number(match[2]), Number(match[3]))) return { value, error: 'Enter a valid date as YYYY-MM-DD.' }
        return { value: trimmed, error: '' }
    }
    if (temporal === 'time') {
        const match = trimmed.match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/)
        if (!match || !isValidClockParts(Number(match[1]), Number(match[2]), Number(match[3] ?? 0))) return { value, error: 'Enter a valid time.' }
        return { value: trimmed, error: '' }
    }
    if (temporal === 'datetime-local') {
        const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/)
        const normalized = fromTemporalInput(trimmed, temporal)
        if (!match || !isValidDateParts(Number(match[1]), Number(match[2]), Number(match[3])) || !isValidClockParts(Number(match[4]), Number(match[5]), Number(match[6] ?? 0))) return { value, error: 'Enter a valid date and time.' }
        return { value: normalized, error: '' }
    }
    if (/\b(?:smallint|integer|bigint|tinyint|mediumint|int\d*|serial|bigserial)\b/i.test(typeName) && !/^[+-]?\d+$/.test(trimmed)) {
        return { value, error: 'Enter a whole number.' }
    }
    if (/\b(?:numeric|decimal|real|double(?: precision)?|float\d*)\b/i.test(typeName) && (trimmed === '' || !Number.isFinite(Number(trimmed)))) {
        return { value, error: 'Enter a valid number.' }
    }
    return { value, error: '' }
}
