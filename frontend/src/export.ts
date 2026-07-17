import { strToU8, zipSync } from 'fflate'
import { SaveBinaryFile, SaveTextFile } from '../wailsjs/go/api/App'
import type { Column, Value } from './ipc/types'

function cellScalar(cell: Value | undefined): unknown {
    if (!cell || cell.t === 'null') return null
    return cell.v ?? null
}

function cellString(cell: Value | undefined): string {
    const value = cellScalar(cell)
    return value === null ? '' : String(value)
}

function delimitedField(value: string, delimiter: string): string {
    if (value.includes(delimiter) || /["\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
    return value
}

function toDelimited(columns: Column[], rows: Value[][], delimiter: string): string {
    const render = (values: string[]) => values.map(value => delimitedField(value, delimiter)).join(delimiter)
    return [render(columns.map(column => column.name)), ...rows.map(row => render(columns.map((_, i) => cellString(row[i]))))].join('\n')
}

export const toCSV = (columns: Column[], rows: Value[][]) => toDelimited(columns, rows, ',')
export const toTSV = (columns: Column[], rows: Value[][]) => toDelimited(columns, rows, '\t')

export function toJSON(columns: Column[], rows: Value[][]): string {
    const used = new Set<string>()
    const names = columns.map(column => {
        let name = column.name
        for (let suffix = 2; used.has(name); suffix++) name = `${column.name}_${suffix}`
        used.add(name)
        return name
    })
    return JSON.stringify(rows.map(row => Object.fromEntries(names.map((name, i) => [name, cellScalar(row[i])]))), null, 2)
}

const escapeHTML = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escapeMarkdown = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')

export function toMarkdown(columns: Column[], rows: Value[][]): string {
    const line = (values: string[]) => `| ${values.map(escapeMarkdown).join(' | ')} |`
    return [line(columns.map(c => c.name)), line(columns.map(() => '---')), ...rows.map(row => line(columns.map((_, i) => cellString(row[i]))))].join('\n')
}

export function toHTML(columns: Column[], rows: Value[][]): string {
    const header = columns.map(c => `<th>${escapeHTML(c.name)}</th>`).join('')
    const body = rows.map(row => `<tr>${columns.map((_, i) => `<td>${escapeHTML(cellString(row[i]))}</td>`).join('')}</tr>`).join('\n')
    return `<!doctype html><meta charset="utf-8"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`
}

const sqlLiteral = (cell: Value | undefined) => {
    const value = cellScalar(cell)
    if (value === null) return 'NULL'
    if (cell?.t === 'i64' || cell?.t === 'f64') return String(value)
    if (cell?.t === 'bool') return value ? 'TRUE' : 'FALSE'
    return `'${String(value).replace(/'/g, "''")}'`
}

export function toSQL(table: string, columns: Column[], rows: Value[][], engine = 'postgres'): string {
    const quote = engine === 'mysql'
        ? (name: string) => `\`${name.replace(/`/g, '``')}\``
        : (name: string) => `"${name.replace(/"/g, '""')}"`
    return rows.map(row => `INSERT INTO ${table.split('.').map(quote).join('.')} (${columns.map(c => quote(c.name)).join(', ')}) VALUES (${columns.map((_, i) => sqlLiteral(row[i])).join(', ')});`).join('\n')
}

function xml(value: string) { return escapeHTML(value) }
function columnName(index: number) { let out = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out; return out }

export function toXLSX(columns: Column[], rows: Value[][]): Uint8Array {
    const all = [columns.map(column => column.name), ...rows.map(row => columns.map((_, i) => cellScalar(row[i])))]
    const sheetRows = all.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
        const ref = `${columnName(c)}${r + 1}`
        return typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${xml(value == null ? '' : String(value))}</t></is></c>`
    }).join('')}</row>`).join('')
    const files: Record<string, Uint8Array> = {
        '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
        '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
        'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'),
        'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
        'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
    }
    return zipSync(files)
}

export type ExportFormat = 'csv' | 'tsv' | 'json' | 'sql' | 'markdown' | 'html' | 'xlsx'

export async function exportRows(baseName: string, format: ExportFormat, columns: Column[], rows: Value[][], table = baseName, engine = 'postgres'): Promise<string> {
    if (format === 'xlsx') {
        const bytes = toXLSX(columns, rows)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return SaveBinaryFile(`${baseName}.xlsx`, btoa(binary))
    }
    const serializers = { csv: toCSV, tsv: toTSV, json: toJSON, markdown: toMarkdown, html: toHTML }
    const content = format === 'sql' ? toSQL(table, columns, rows, engine) : serializers[format](columns, rows)
    const extension = format === 'markdown' ? 'md' : format
    return SaveTextFile(`${baseName}.${extension}`, content)
}
