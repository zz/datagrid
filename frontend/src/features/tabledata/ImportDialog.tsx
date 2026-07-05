import { useMemo, useState } from 'react'
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

    const tableColumns = useMemo(() => (view?.info?.columns ?? []).map(c => c.name), [view])
    const nullable = useMemo(
        () => new Map((view?.info?.columns ?? []).map(c => [c.name, c.nullable])),
        [view],
    )

    // Parse a preview so the user sees how columns line up before importing.
    const parsed = useMemo(() => {
        if (!text.trim()) return null
        const res = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true })
        const fields = res.meta.fields ?? []
        const matched = fields.filter(f => tableColumns.includes(f))
        return { rows: res.data, fields, matched, errors: res.errors }
    }, [text, tableColumns])

    const onFile = (file: File) => {
        const reader = new FileReader()
        reader.onload = () => setText(String(reader.result ?? ''))
        reader.readAsText(file)
    }

    const doImport = async () => {
        if (!parsed || parsed.matched.length === 0) return
        setBusy(true)
        setStatus('Importing…')
        try {
            const changes = parsed.rows.map(row =>
                drivers.RowChange.createFrom({
                    kind: 'insert',
                    key: {},
                    set: Object.fromEntries(
                        parsed.matched.map(col => {
                            const v = row[col] ?? ''
                            const isNull = v === '' && !!nullable.get(col)
                            return [col, { null: isNull, text: v }]
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
                <h2>Import CSV into {tab.table}</h2>
                <p className="import-hint">
                    CSV needs a header row. Columns whose names match the table are imported; others are ignored.
                </p>
                <input type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
                <textarea
                    className="import-textarea"
                    placeholder="…or paste CSV here"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    spellCheck={false}
                />
                {parsed && (
                    <div className="import-summary">
                        <div>
                            {parsed.rows.length} rows · matched columns:{' '}
                            {parsed.matched.length ? parsed.matched.join(', ') : <em>none</em>}
                        </div>
                        {parsed.fields.filter(f => !parsed.matched.includes(f)).length > 0 && (
                            <div className="import-ignored">
                                ignored: {parsed.fields.filter(f => !parsed.matched.includes(f)).join(', ')}
                            </div>
                        )}
                    </div>
                )}
                {status && <div className="dialog-status">{status}</div>}
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onClose}>Cancel</button>
                    <button
                        className="primary"
                        disabled={busy || !parsed || parsed.matched.length === 0}
                        onClick={doImport}
                    >
                        Import
                    </button>
                </div>
            </div>
        </div>
    )
}
