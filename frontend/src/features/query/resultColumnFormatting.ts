import type { Column, Value } from '../../ipc/types'
import { displayValue } from '../../ipc/types'

export type ResultNumberFormat = 'raw' | 'locale' | 'fixed'
export type ResultDateFormat = 'raw' | 'date' | 'datetime' | 'iso'
export type ResultBooleanFormat = 'raw' | 'yes-no'

export interface ResultColumnFormat {
    number?: ResultNumberFormat
    decimals?: number
    date?: ResultDateFormat
    boolean?: ResultBooleanFormat
    nullText?: string
    maxLength?: number | null
}

export type ResultColumnFormats = Record<string, ResultColumnFormat>

export function resultColumnFormattingKey(columnLayoutKey: string): string {
    return `datagrid.result-formats.v1:${columnLayoutKey}`
}

export function isNumericResultColumn(column: Column): boolean {
    return /(?:^|\b)(?:tinyint|smallint|integer|int|bigint|decimal|numeric|real|double|float|money)(?:\b|$)/i.test(column.typeName)
}

export function isTemporalResultColumn(column: Column): boolean {
    return /(?:date|time|timestamp|datetime)/i.test(column.typeName)
}

export function isBooleanResultColumn(column: Column): boolean {
    return /(?:^|\b)(?:bool|boolean|bit)(?:\b|$)/i.test(column.typeName)
}

export function normalizeResultColumnFormat(format: Partial<ResultColumnFormat> | null | undefined): ResultColumnFormat {
    const normalized: ResultColumnFormat = {}
    if (format?.number === 'locale' || format?.number === 'fixed') normalized.number = format.number
    if (typeof format?.decimals === 'number' && Number.isFinite(format.decimals)) normalized.decimals = Math.max(0, Math.min(10, Math.floor(format.decimals)))
    if (format?.date === 'date' || format?.date === 'datetime' || format?.date === 'iso') normalized.date = format.date
    if (format?.boolean === 'yes-no') normalized.boolean = format.boolean
    if (typeof format?.nullText === 'string' && format.nullText !== 'NULL') normalized.nullText = format.nullText.slice(0, 40)
    if (format?.maxLength === null) normalized.maxLength = null
    else if (typeof format?.maxLength === 'number' && Number.isFinite(format.maxLength)) normalized.maxLength = Math.max(8, Math.min(100000, Math.floor(format.maxLength)))
    return normalized
}

export function normalizeResultColumnFormats(formats: unknown, columnIds: string[]): ResultColumnFormats {
    if (!formats || typeof formats !== 'object' || Array.isArray(formats)) return {}
    const source = formats as Record<string, unknown>
    return Object.fromEntries(columnIds.flatMap(id => {
        const normalized = normalizeResultColumnFormat(source[id] as Partial<ResultColumnFormat> | undefined)
        return Object.keys(normalized).length ? [[id, normalized]] : []
    }))
}

function booleanValue(value: Value): boolean {
    return value.v === true || String(value.v).toLowerCase() === 'true' || String(value.v) === '1'
}

function temporalValue(value: Value): Date | null {
    const parsed = new Date(String(value.v ?? ''))
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatResultCell(value: Value, column: Column, format: ResultColumnFormat = {}): string {
    if (value.t === 'null') return format.nullText ?? 'NULL'
    let text = displayValue(value)
    if (isNumericResultColumn(column) && format.number && format.number !== 'raw') {
        const numeric = Number(value.v)
        if (Number.isFinite(numeric)) {
            const decimals = format.decimals ?? 2
            text = format.number === 'fixed'
                ? numeric.toFixed(decimals)
                : numeric.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        }
    } else if (isTemporalResultColumn(column) && format.date && format.date !== 'raw') {
        const date = temporalValue(value)
        if (date) {
            text = format.date === 'iso' ? date.toISOString()
                : format.date === 'date' ? date.toLocaleDateString()
                    : date.toLocaleString()
        }
    } else if (isBooleanResultColumn(column) && format.boolean === 'yes-no') {
        text = booleanValue(value) ? 'Yes' : 'No'
    }
    const maximum = format.maxLength
    if (maximum != null && text.length > maximum) return `${text.slice(0, Math.max(0, maximum - 1))}\u2026`
    return text
}

export function loadResultColumnFormats(key: string, columnIds: string[], storage: Storage = window.localStorage): ResultColumnFormats {
    try { return normalizeResultColumnFormats(JSON.parse(storage.getItem(key) ?? 'null'), columnIds) } catch { return {} }
}

export function saveResultColumnFormats(key: string, formats: ResultColumnFormats, storage: Storage = window.localStorage) {
    try { storage.setItem(key, JSON.stringify(formats)) } catch { /* Display preferences must not break result rendering. */ }
}
