export function schemaTables(autocomplete: Record<string, string[]>, schema: string): string[] {
    const prefix = `${schema}.`
    return Object.keys(autocomplete).filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length)).sort()
}

export type SchemaTableStatus = 'match' | 'changed' | 'missing-target' | 'extra-target'

export function classifySchemaTables(origin: string[], target: string[]): Array<{ name: string; status: SchemaTableStatus }> {
    const originSet = new Set(origin)
    const targetSet = new Set(target)
    return [...new Set([...origin, ...target])].sort().map(name => ({
        name,
        status: !targetSet.has(name) ? 'missing-target' : !originSet.has(name) ? 'extra-target' : 'match',
    }))
}
