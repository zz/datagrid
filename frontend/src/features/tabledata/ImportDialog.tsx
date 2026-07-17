import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { ApplyChangeset } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp, Tab } from '../../store'

// ImportDialog parses CSV and bulk-inserts it through the same transactional
// changeset path as manual edits — DataGrip-style CSV import.
export default function ImportDialog({ tab, onClose }: { tab: Tab; onClose: () => void }) {
    const view = useApp(s => s.tableViews[tab.id])
    const { reloadTable, setError } = useApp()
    const [text, setText] = useState('')
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState('')
    const [format, setFormat] = useState<'csv' | 'tsv' | 'json'>('csv')
    const [mapping, setMapping] = useState<Record<string, string>>({})
    const [blankPolicy, setBlankPolicy] = useState<'null' | 'empty' | 'omit'>('null')

    const tableColumns = useMemo(() => (view?.info?.columns ?? []).map(c => c.name), [view])
    const nullable = useMemo(
        () => new Map((view?.info?.columns ?? []).map(c => [c.name, c.nullable])),
        [view],
    )

    // Parse a preview so the user sees how columns line up before importing.
    const parsed = useMemo(() => {
        if (!text.trim()) return null
        if (format === 'json') {
            try {
                const value = JSON.parse(text)
                if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
                    return { rows: [], fields: [], errors: ['JSON must be an array of objects.'] }
                }
                const fields = [...new Set(value.flatMap(row => Object.keys(row)))]
                const rows = value.map(row => Object.fromEntries(fields.map(field => {
                    const cell = row[field]
                    return [field, cell == null ? '' : typeof cell === 'object' ? JSON.stringify(cell) : String(cell)]
                })))
                return { rows, fields, errors: [] as string[] }
            } catch (err) {
                return { rows: [], fields: [], errors: [String(err)] }
            }
        }
        const res = Papa.parse<Record<string, string>>(text.trim(), {
            header: true,
            skipEmptyLines: true,
            delimiter: format === 'tsv' ? '\t' : ',',
        })
        return { rows: res.data, fields: res.meta.fields ?? [], errors: res.errors.map(error => error.message) }
    }, [text, format])

    useEffect(() => {
        if (!parsed) return
        setMapping(current => Object.fromEntries(parsed.fields.map(field => [field, current[field] ?? (tableColumns.includes(field) ? field : '')])))
    }, [parsed, tableColumns])

    const onFile = (file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase()
        if (ext === 'json') setFormat('json')
        else if (ext === 'tsv' || ext === 'tab') setFormat('tsv')
        else setFormat('csv')
        const reader = new FileReader()
        reader.onload = () => setText(String(reader.result ?? ''))
        reader.readAsText(file)
    }

    const doImport = async () => {
        if (!parsed || Object.values(mapping).every(value => !value)) return
        setBusy(true)
        setStatus('Importing…')
        try {
            const changes = parsed.rows.map(row =>
                drivers.RowChange.createFrom({
                    kind: 'insert',
                    key: {},
                    set: Object.fromEntries(
                        parsed.fields.flatMap(source => {
                            const target = mapping[source]
                            if (!target) return []
                            const value = row[source] ?? ''
                            if (value === '' && blankPolicy === 'omit') return []
                            const isNull = value === '' && blankPolicy === 'null' && !!nullable.get(target)
                            return [[target, { null: isNull, text: value }] as const]
                        }),
                    ),
                }),
            )
            const result = await ApplyChangeset(
                tab.connId,
                drivers.ChangesetRequest.createFrom({ schema: tab.schema, table: tab.table, changes }),
            )
            await reloadTable(tab.id)
            setStatus(`Imported ${result.rowsAffected} rows.`)
            setTimeout(onClose, 800)
        } catch (err) {
            setError(String(err))
            setStatus(`Failed: ${err}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal import-dialog">
                <h2>Import Data into {tab.table}</h2>
                <p className="import-hint">
                    Delimited files need a header row. Map source fields to table columns before importing.
                </p>
                <div className="import-source-row">
                    <select value={format} onChange={event => setFormat(event.target.value as typeof format)}>
                        <option value="csv">CSV</option><option value="tsv">TSV</option><option value="json">JSON</option>
                    </select>
                    <input type="file" accept=".csv,.tsv,.tab,.json,text/csv,text/tab-separated-values,application/json" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
                </div>
                <textarea
                    className="import-textarea"
                    placeholder={`…or paste ${format.toUpperCase()} here`}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    spellCheck={false}
                />
                {parsed && (
                    <div className="import-summary">
                        <div>{parsed.rows.length} rows</div>
                        {parsed.errors.length > 0 && <div className="import-errors">{parsed.errors.slice(0, 3).join(' · ')}</div>}
                        <div className="import-mapping">
                            {parsed.fields.map(source => (
                                <label key={source}><span>{source}</span><span>→</span>
                                    <select value={mapping[source] ?? ''} onChange={event => setMapping(current => ({ ...current, [source]: event.target.value }))}>
                                        <option value="">Ignore</option>
                                        {tableColumns.map(column => <option key={column} value={column}>{column}</option>)}
                                    </select>
                                </label>
                            ))}
                        </div>
                        <label className="import-blank-policy">Blank values
                            <select value={blankPolicy} onChange={event => setBlankPolicy(event.target.value as typeof blankPolicy)}>
                                <option value="null">NULL when nullable</option><option value="empty">Empty string</option><option value="omit">Use column default</option>
                            </select>
                        </label>
                    </div>
                )}
                {status && <div className="dialog-status">{status}</div>}
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onClose}>Cancel</button>
                    <button
                        className="primary"
                        disabled={busy || !parsed || parsed.errors.length > 0 || Object.values(mapping).every(value => !value)}
                        onClick={doImport}
                    >
                        Import
                    </button>
                </div>
            </div>
        </div>
    )
}
