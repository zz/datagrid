import { describe, expect, it } from 'vitest'
import { drivers } from '../../../wailsjs/go/models'
import { compareColumns, targetDrafts } from './comparison'

const column = (name: string, typeName: string, nullable = true) => drivers.ColumnInfo.createFrom({ name, typeName, nullable, default: '' })

describe('table comparison', () => {
    it('classifies added, removed, and changed columns', () => {
        const result = compareColumns(
            [column('id', 'bigint', false), column('email', 'text')],
            [column('id', 'integer', false), column('legacy', 'text')],
        )
        expect(result.map(item => `${item.name}:${item.status}`)).toEqual(['id:changed', 'email:added', 'legacy:removed'])
    })

    it('maps same-name target columns and treats missing ones as additions', () => {
        expect(targetDrafts([column('id', 'bigint'), column('email', 'text')], [column('id', 'integer')])).toMatchObject([
            { originalName: 'id' }, { name: 'email', originalName: undefined },
        ])
    })
})
