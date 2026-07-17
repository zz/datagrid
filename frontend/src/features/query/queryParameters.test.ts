import { describe, expect, it } from 'vitest'
import { queryParameterNames } from './queryParameters'

describe('queryParameterNames', () => {
    it('finds distinct named parameters outside SQL syntax', () => {
        expect(queryParameterNames("select :id, :id, ':skip', $$:body$$, value::text -- :comment\nwhere name=:name /* :block */")).toEqual(['id', 'name'])
    })

    it('ignores parameters behind escaped quotes', () => {
        expect(queryParameterNames("select 'it\\':skip', :real", 'mysql')).toEqual(['real'])
    })
})
