import { useEffect, useMemo, useState } from 'react'
import { DatabaseZap, Save, Trash2 } from 'lucide-react'
import { ApplyChangeset, LoadTableRows } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { Tab, useApp } from '../../store'
import { generateTestRows, GeneratorConfig, GeneratorKind, inferGenerator } from './testData'
import { displayValue } from '../../ipc/types'
import { loadTestDataPresets, saveTestDataPresets, TestDataPreset } from './testDataPresets'
import NameDialog from '../../components/NameDialog'

const GENERATORS: Array<{ value: GeneratorKind; label: string }> = [
    { value: 'omit', label: 'Use server default' }, { value: 'foreign-key', label: 'Referenced values' }, { value: 'sequence', label: 'Sequence' },
    { value: 'uuid', label: 'UUID' }, { value: 'name', label: 'Person name' }, { value: 'email', label: 'Email' },
    { value: 'number', label: 'Random number' }, { value: 'boolean', label: 'Boolean' }, { value: 'date', label: 'Date' },
    { value: 'json', label: 'JSON object' }, { value: 'text', label: 'Indexed text' }, { value: 'constant', label: 'Constant' },
    { value: 'null', label: 'NULL' },
]

export default function TestDataDialog({ tab, onClose }: { tab: Tab; onClose: () => void }) {
    const view = useApp(state => state.tableViews[tab.id])
    const { reloadTable, setError } = useApp()
    const info = view?.info
    const columns = useMemo(() => info?.columns ?? [], [info])
    const [configs, setConfigs] = useState<Record<string, GeneratorConfig>>(() => Object.fromEntries((info?.columns ?? []).map(column => [column.name,
        info?.foreignKeys.some(key => key.columns.includes(column.name)) ? { kind: 'foreign-key' } : inferGenerator(column, info?.primaryKey.includes(column.name) ?? false),
    ])))
    const [count, setCount] = useState(25)
    const [seed, setSeed] = useState('datagrid')
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState('')
    const [loadingReferences, setLoadingReferences] = useState(false)
    const [presets, setPresets] = useState<TestDataPreset[]>(loadTestDataPresets)
    const [presetId, setPresetId] = useState('')
    const [savePreset, setSavePreset] = useState(false)
    const preview = useMemo(() => generateTestRows(columns, configs, Math.min(5, count), seed), [columns, configs, count, seed])
    useEffect(() => {
        if (!info?.foreignKeys.length) return
        let active = true
        setLoadingReferences(true)
        Promise.all(info.foreignKeys.map(async key => {
            const page = await LoadTableRows(tab.connId, drivers.PageRequest.createFrom({
                schema: key.referencedSchema, table: key.referencedTable, whereRaw: '', sorts: [], filters: [], limit: 200, offset: 0,
            }))
            return { key, page }
        })).then(results => {
            if (!active) return
            setConfigs(current => {
                const next = { ...current }
                results.forEach(({ key, page }) => key.columns.forEach((column, index) => {
                    const referenced = key.referencedColumns[index]
                    const columnIndex = page.columns.findIndex(item => item.name === referenced)
                    const values = columnIndex < 0 ? [] : page.rows.flatMap(row => {
                        const value = row[columnIndex]
                        return value && value.t !== 'null' ? [displayValue(value)] : []
                    })
                    next[column] = { ...(next[column] ?? { kind: 'foreign-key' }), kind: 'foreign-key', values }
                }))
                return next
            })
        }).catch(error => setError(String(error))).finally(() => active && setLoadingReferences(false))
        return () => { active = false }
    }, [info, setError, tab.connId])
    if (!info) return null
    const missingReferences = Object.values(configs).some(config => config.kind === 'foreign-key' && !config.values?.length)

    const applyPreset = (id: string) => {
        setPresetId(id)
        const preset = presets.find(item => item.id === id)
        if (!preset) return
        setConfigs(current => Object.fromEntries(columns.map(column => {
            const saved = preset.configs[column.name]
            return [column.name, saved ? { ...saved, values: saved.kind === 'foreign-key' ? current[column.name]?.values : undefined } : current[column.name]]
        })))
    }

    const generate = async () => {
        setBusy(true)
        setStatus('Generating and inserting rows...')
        try {
            const rows = generateTestRows(columns, configs, count, seed)
            const changes = rows.map(set => drivers.RowChange.createFrom({ kind: 'insert', key: {}, set }))
            const result = await ApplyChangeset(tab.connId, drivers.ChangesetRequest.createFrom({ schema: tab.schema, table: tab.table, changes }))
            await reloadTable(tab.id, true, true)
            setStatus(`Inserted ${result.rowsAffected} rows.`)
            setTimeout(onClose, 700)
        } catch (error) {
            setError(String(error))
            setStatus(`Failed: ${error}`)
        } finally { setBusy(false) }
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
        <div className="modal test-data-dialog">
            <div className="test-data-title"><DatabaseZap size={17} /><div><h2>Generate Test Data</h2><span>{info.schema}.{info.table}</span></div></div>
            <div className="test-data-settings"><label>Rows<input type="number" min={1} max={1000} value={count} onChange={event => setCount(Math.max(1, Math.min(1000, Number(event.target.value))))} /></label><label>Seed<input value={seed} onChange={event => setSeed(event.target.value)} /></label><label>Preset<select value={presetId} onChange={event => applyPreset(event.target.value)}><option value="">None</option>{presets.map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label><button className="icon-btn" onClick={() => setSavePreset(true)} title="Save generator preset"><Save size={12} /></button><button className="icon-btn" disabled={!presetId} onClick={() => { const next = presets.filter(item => item.id !== presetId); setPresets(next); saveTestDataPresets(next); setPresetId('') }} title="Delete preset"><Trash2 size={12} /></button><span>{loadingReferences ? 'Loading referenced values...' : 'Generation is repeatable for the same seed.'}</span></div>
            <div className="test-data-columns"><div className="test-data-column heading"><span>Column</span><span>Type</span><span>Generator</span><span>Value</span></div>{columns.map(column => {
                const config = configs[column.name]
                const isForeignKey = info.foreignKeys.some(key => key.columns.includes(column.name))
                return <div className="test-data-column" key={column.name}><strong>{column.name}{info.primaryKey.includes(column.name) && <small>PK</small>}</strong><code>{column.typeName}</code><select value={config.kind} onChange={event => setConfigs(current => ({ ...current, [column.name]: { kind: event.target.value as GeneratorKind, values: current[column.name]?.values } }))}>{GENERATORS.map(generator => <option key={generator.value} value={generator.value} disabled={(generator.value === 'null' && !column.nullable) || (generator.value === 'foreign-key' && !isForeignKey)}>{generator.label}</option>)}</select>{config.kind === 'constant' ? <input value={config.value ?? ''} onChange={event => setConfigs(current => ({ ...current, [column.name]: { ...config, value: event.target.value } }))} /> : <span>{config.kind === 'omit' ? column.default || 'DEFAULT' : config.kind === 'foreign-key' ? `${config.values?.length ?? 0} sampled values` : ''}</span>}</div>
            })}</div>
            <div className="test-data-preview"><h3>Preview</h3><div><table><thead><tr>{columns.filter(column => configs[column.name].kind !== 'omit').map(column => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{preview.map((row, index) => <tr key={index}>{columns.filter(column => configs[column.name].kind !== 'omit').map(column => { const value = row[column.name]; return <td key={column.name}>{value?.null ? 'NULL' : value?.text ?? ''}</td> })}</tr>)}</tbody></table></div></div>
            {missingReferences && !loadingReferences && <div className="migration-warning">A referenced-value generator has no available source rows. Choose another generator or populate the referenced table first.</div>}
            {status && <div className="dialog-status">{status}</div>}
            <div className="modal-buttons"><span>Rows are inserted in one transactional changeset when supported.</span><div className="spacer" /><button onClick={onClose} disabled={busy}>Cancel</button><button className="primary" onClick={() => void generate()} disabled={busy || loadingReferences || missingReferences || count < 1}>Generate Rows</button></div>
        </div>
        {savePreset && <NameDialog title="Save generator preset" value="" onCancel={() => setSavePreset(false)} onSubmit={name => {
            const trimmed = name.trim()
            if (!trimmed) return
            const preset = { id: `preset-${Date.now()}`, name: trimmed, configs }
            const next = [...presets, preset]
            setPresets(next); saveTestDataPresets(next); setPresetId(preset.id); setSavePreset(false)
        }} />}
    </div>
}
