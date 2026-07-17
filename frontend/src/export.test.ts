import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { Column, Value } from './ipc/types'
import { toCSV, toHTML, toJSON, toMarkdown, toSQL, toTSV, toXLSX } from './export'

const columns: Column[] = [{ name: 'id', typeName: 'int' }, { name: 'name', typeName: 'text' }]
const rows: Value[][] = [[{ t: 'i64', v: 1 }, { t: 'str', v: 'Ada, Inc.' }], [{ t: 'null' }, { t: 'str', v: '<Grace>' }]]

describe('data export formats', () => {
    it('serializes text formats with escaping', () => {
        expect(toCSV(columns, rows)).toContain('"Ada, Inc."')
        expect(toTSV(columns, rows)).toContain('Ada, Inc.')
        expect(toJSON(columns, rows)).toContain('"id": null')
        expect(toJSON([{ name: 'id', typeName: 'int' }, { name: 'id', typeName: 'int' }], [[{ t: 'i64', v: 1 }, { t: 'i64', v: 2 }]])).toContain('"id_2": 2')
        expect(toMarkdown(columns, rows)).toContain('| id | name |')
        expect(toHTML(columns, rows)).toContain('&lt;Grace&gt;')
        expect(toSQL('public.people', columns, rows)).toContain('INSERT INTO "public"."people"')
        expect(toSQL('app.people', columns, rows, 'mysql')).toContain('INSERT INTO `app`.`people`')
    })

    it('creates an XLSX workbook with worksheet data', () => {
        const files = unzipSync(toXLSX(columns, rows))
        const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
        expect(sheet).toContain('Ada, Inc.')
        expect(sheet).toContain('<v>1</v>')
    })
})
