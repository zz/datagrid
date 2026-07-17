import { describe, expect, it } from 'vitest'
import { normalizeObjectDDL, objectDropSQL, remapObjectDDL } from './objectSync'

describe('schema object synchronization', () => {
    it('normalizes schema-qualified object identity', () => {
        expect(normalizeObjectDDL('CREATE VIEW "a"."recent" AS SELECT 1;', 'a', 'recent')).toBe('create view <object> as select 1')
        expect(normalizeObjectDDL('CREATE VIEW "b"."recent" AS SELECT 1;', 'b', 'recent')).toBe('create view <object> as select 1')
    })
    it('remaps schema references and removes MySQL definers', () => {
        const ddl = 'CREATE DEFINER=`root`@`%` VIEW `source`.`recent` AS SELECT * FROM `source`.`users`;'
        const mapped = remapObjectDDL(ddl, 'mysql', 'source', 'target')
        expect(mapped).not.toContain('DEFINER')
        expect(mapped).toContain('`target`.`recent`')
        expect(mapped).toContain('`target`.`users`')
    })
    it('does not generate ambiguous routine drops', () => expect(objectDropSQL('postgres', 'routine', 'public', 'run')).toBe(''))
    it('generates table-aware PostgreSQL trigger drops', () => expect(objectDropSQL('postgres', 'trigger', 'public', 'audit_users', 'users')).toBe('DROP TRIGGER "audit_users" ON "public"."users";'))
    it('ignores schema differences in referenced objects', () => {
        expect(normalizeObjectDDL('CREATE TRIGGER audit AFTER INSERT ON "a"."users" EXECUTE FUNCTION "a"."log"()', 'a', 'audit'))
            .toBe(normalizeObjectDDL('CREATE TRIGGER audit AFTER INSERT ON "b"."users" EXECUTE FUNCTION "b"."log"()', 'b', 'audit'))
    })
})
