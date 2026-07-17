export type CreatableObjectKind = 'view' | 'routine' | 'trigger'

function qualified(engine: string, schema: string, name: string): string {
    const quote = engine === 'mysql' ? '`' : '"'
    return `${quote}${schema}${quote}.${quote}${name}${quote}`
}

export function objectTemplate(engine: string, kind: CreatableObjectKind, schema: string, name: string): string {
    const object = qualified(engine, schema, name)
    if (kind === 'view') return `CREATE VIEW ${object} AS\nSELECT\n    *\nFROM\n    ${qualified(engine, schema, 'source_table')};`
    if (engine === 'mysql') {
        if (kind === 'routine') return `CREATE PROCEDURE ${object}()\nBEGIN\n    SELECT 1;\nEND;`
        return `CREATE TRIGGER ${object}\nBEFORE INSERT ON ${qualified(engine, schema, 'target_table')}\nFOR EACH ROW\nBEGIN\n    SET NEW.updated_at = CURRENT_TIMESTAMP;\nEND;`
    }
    if (kind === 'routine') return `CREATE OR REPLACE FUNCTION ${object}()\nRETURNS void\nLANGUAGE plpgsql\nAS $$\nBEGIN\n    -- function body\nEND;\n$$;`
    return `CREATE TRIGGER "${name}"\nBEFORE INSERT ON ${qualified(engine, schema, 'target_table')}\nFOR EACH ROW\nEXECUTE FUNCTION ${qualified(engine, schema, 'trigger_function')}();`
}
