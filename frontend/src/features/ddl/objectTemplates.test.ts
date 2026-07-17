import { describe, expect, it } from 'vitest'
import { objectTemplate } from './objectTemplates'

describe('database object templates', () => {
    it('creates PostgreSQL dollar-quoted function source', () => {
        const source = objectTemplate('postgres', 'routine', 'public', 'refresh_cache')
        expect(source).toContain('CREATE OR REPLACE FUNCTION "public"."refresh_cache"()')
        expect(source).toContain('AS $$')
    })
    it('creates MySQL routine and trigger bodies without delimiter commands', () => {
        expect(objectTemplate('mysql', 'routine', 'app', 'refresh_cache')).toContain('CREATE PROCEDURE `app`.`refresh_cache`()')
        expect(objectTemplate('mysql', 'trigger', 'app', 'touch_row')).toContain('CREATE TRIGGER `app`.`touch_row`')
    })
})
