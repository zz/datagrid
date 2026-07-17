import { drivers } from '../../../wailsjs/go/models'

export type GeneratorKind = 'omit' | 'foreign-key' | 'sequence' | 'uuid' | 'name' | 'email' | 'number' | 'boolean' | 'date' | 'json' | 'text' | 'constant' | 'null'
export interface GeneratorConfig { kind: GeneratorKind; value?: string; values?: string[] }

export function inferGenerator(column: drivers.ColumnInfo, primaryKey: boolean): GeneratorConfig {
    const type = column.typeName.toLowerCase()
    const name = column.name.toLowerCase()
    if (column.default.trim()) return { kind: 'omit' }
    if (primaryKey && /(int|serial|numeric|decimal)/.test(type)) return { kind: 'sequence' }
    if (type.includes('uuid') || name.includes('uuid')) return { kind: 'uuid' }
    if (name.includes('email')) return { kind: 'email' }
    if (/(first_?name|last_?name|full_?name|^name$)/.test(name)) return { kind: 'name' }
    if (/bool|tinyint\(1\)/.test(type)) return { kind: 'boolean' }
    if (/date|time/.test(type)) return { kind: 'date' }
    if (/json/.test(type)) return { kind: 'json' }
    if (/int|numeric|decimal|float|double|real/.test(type)) return { kind: 'number' }
    return { kind: 'text' }
}

const hash = (value: string) => [...value].reduce((result, char) => Math.imul(result ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0
const randomFrom = (seed: number) => {
    let value = seed
    return () => { value += 0x6D2B79F5; let result = value; result = Math.imul(result ^ result >>> 15, result | 1); result ^= result + Math.imul(result ^ result >>> 7, result | 61); return ((result ^ result >>> 14) >>> 0) / 4294967296 }
}

export function generateTestRows(columns: drivers.ColumnInfo[], configs: Record<string, GeneratorConfig>, count: number, seed: string): Array<Record<string, { null: boolean; text: string }>> {
    const random = randomFrom(hash(seed))
    const first = ['Alex', 'Casey', 'Jordan', 'Morgan', 'Riley', 'Sam', 'Taylor']
    const last = ['Chen', 'Garcia', 'Johnson', 'Khan', 'Martin', 'Patel', 'Smith']
    return Array.from({ length: Math.max(0, Math.min(1000, count)) }, (_, index) => Object.fromEntries(columns.flatMap<[string, { null: boolean; text: string }]>(column => {
        const config = configs[column.name] ?? inferGenerator(column, false)
        if (config.kind === 'omit') return []
        if (config.kind === 'null') return [[column.name, { null: true, text: '' }]]
        const number = index + 1
        const hex = () => Math.floor(random() * 0xffffffff).toString(16).padStart(8, '0')
        let text = ''
        switch (config.kind) {
            case 'foreign-key': text = config.values?.[index % Math.max(1, config.values?.length ?? 0)] ?? ''; break
            case 'sequence': text = String(number); break
            case 'uuid': text = `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-a${hex().slice(0, 3)}-${hex()}${hex().slice(0, 4)}`; break
            case 'name': text = `${first[Math.floor(random() * first.length)]} ${last[Math.floor(random() * last.length)]}`; break
            case 'email': text = `user${number}@example.test`; break
            case 'number': text = String(Math.floor(random() * 10000) + 1); break
            case 'boolean': text = random() >= 0.5 ? 'true' : 'false'; break
            case 'date': {
                const date = new Date(Date.UTC(2024, 0, 1 + index, index % 24, index % 60, index % 60))
                const type = column.typeName.toLowerCase()
                text = /timestamp|datetime/.test(type) ? date.toISOString().slice(0, 19).replace('T', ' ')
                    : /^time\b/.test(type) ? date.toISOString().slice(11, 19) : date.toISOString().slice(0, 10)
                break
            }
            case 'json': text = JSON.stringify({ index: number, generated: true }); break
            case 'constant': text = config.value ?? ''; break
            default: text = `${column.name}_${number}`
        }
        return [[column.name, { null: false, text }]]
    })))
}
