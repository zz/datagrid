import { GeneratorConfig } from './testData'

export interface TestDataPreset { id: string; name: string; configs: Record<string, GeneratorConfig> }
const STORAGE_KEY = 'datagrid.test-data-presets.v1'

export function loadTestDataPresets(storage: Storage = localStorage): TestDataPreset[] {
    try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && item.configs && typeof item.configs === 'object') : []
    } catch { return [] }
}

export function saveTestDataPresets(presets: TestDataPreset[], storage: Storage = localStorage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(presets.map(preset => ({ ...preset, configs: Object.fromEntries(Object.entries(preset.configs).map(([name, config]) => [name, { kind: config.kind, value: config.value }])) }))))
}
