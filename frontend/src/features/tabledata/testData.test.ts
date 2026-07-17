import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { generateTestRows, inferGenerator } from './testData'

describe('test data generation', () => {
    it('infers generators and omits server defaults', () => {
        expect(inferGenerator(drivers.ColumnInfo.createFrom({ name: 'email', typeName: 'text', default: '', nullable: false }), false).kind).toBe('email')
        expect(inferGenerator(drivers.ColumnInfo.createFrom({ name: 'id', typeName: 'bigint', default: 'nextval()', nullable: false }), true).kind).toBe('omit')
    })
    it('is deterministic and bounded', () => {
        const columns = [drivers.ColumnInfo.createFrom({ name: 'score', typeName: 'int', default: '', nullable: false })]
        expect(generateTestRows(columns, { score: { kind: 'number' } }, 2, 'seed')).toEqual(generateTestRows(columns, { score: { kind: 'number' } }, 2, 'seed'))
        expect(generateTestRows(columns, { score: { kind: 'number' } }, 2000, 'seed')).toHaveLength(1000)
    })
    it('formats temporal generators for native column types', () => {
        const column = drivers.ColumnInfo.createFrom({ name: 'created_at', typeName: 'timestamp', default: '', nullable: false })
        expect(generateTestRows([column], { created_at: { kind: 'date' } }, 1, 'seed')[0].created_at.text).toMatch(/^2024-01-01 00:00:00$/)
    })
})
