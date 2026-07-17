import { describe, expect, it } from 'vitest'
import { renderSnippet, snippetTrigger } from './sqlSnippets'

describe('SQL snippets', () => {
    it('derives a stable trigger from a name', () => expect(snippetTrigger('Recent Active Users')).toBe('recent_active_users'))
    it('removes the cursor marker and returns its offset', () => {
        expect(renderSnippet('SELECT $CURSOR$ FROM users')).toEqual({ text: 'SELECT  FROM users', cursor: 7 })
    })
})
