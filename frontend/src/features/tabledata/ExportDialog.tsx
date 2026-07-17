import { useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { LoadTableRows } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import type { Value } from '../../ipc/types'
import type { Tab, TableView } from '../../store'
import { ExportFormat, exportRows } from '../../export'

type Scope = 'selection' | 'page' | 'all'

export default function ExportDialog({
    tab,
    view,
    visibleColumnIndexes,
    shownRows,
    selection,
    onClose,
    onError,
    engine,
}: {
    tab: Tab
    view: TableView
    visibleColumnIndexes: number[]
    shownRows: Value[][]
    selection?: { x: number; y: number; width: number; height: number }
    onClose: () => void
    onError: (message: string) => void
    engine: string
}) {
    const [format, setFormat] = useState<ExportFormat>('csv')
    const [scope, setScope] = useState<Scope>(selection ? 'selection' : 'page')
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState('')
    const cancelled = useRef(false)
    const columns = visibleColumnIndexes.map(index => view.columns[index])
    const project = (row: Value[]) => visibleColumnIndexes.map(index => row[index])

    const selectedRows = () => {
        if (!selection) return { columns: [] as typeof columns, rows: [] as Value[][] }
        const indexes = visibleColumnIndexes.slice(selection.x, selection.x + selection.width)
        return {
            columns: indexes.map(index => view.columns[index]),
            rows: shownRows.slice(selection.y, selection.y + selection.height).map(row => indexes.map(index => row[index])),
        }
    }

    const allRows = async () => {
        const rows: Value[][] = []
        const pageSize = 1000
        for (let offset = 0; ; offset += pageSize) {
            if (cancelled.current) throw new Error('Export cancelled')
            setStatus(`Loading ${offset.toLocaleString()}${view.total != null ? ` of ${view.total.toLocaleString()}` : ''} rows…`)
            const page = await LoadTableRows(tab.connId, drivers.PageRequest.createFrom({
                schema: tab.schema,
                table: tab.table,
                whereRaw: view.whereRaw,
                sorts: view.sorts,
                filters: view.filters,
                limit: pageSize,
                offset,
            }))
            rows.push(...((page.rows ?? []) as unknown as Value[][]).map(project))
            if (!page.hasMore) break
        }
        return rows
    }

    const run = async () => {
        setBusy(true)
        cancelled.current = false
        try {
            let exportColumns = columns
            let rows: Value[][]
            if (scope === 'selection') {
                const selected = selectedRows()
                exportColumns = selected.columns
                rows = selected.rows
            } else if (scope === 'all') rows = await allRows()
            else rows = view.rows.map(project)
            if (cancelled.current) return
            setStatus(`Writing ${rows.length.toLocaleString()} rows…`)
            await exportRows(tab.table ?? 'data', format, exportColumns, rows, `${tab.schema}.${tab.table}`, engine)
            onClose()
        } catch (err) {
            if (String(err).includes('cancelled')) setStatus('Cancelled.')
            else { onError(String(err)); setStatus(`Failed: ${err}`) }
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
            <div className="modal export-dialog">
                <h2><Download size={17} /> Export {tab.table}</h2>
                <div className="export-options">
                    <label>Format<select value={format} onChange={event => setFormat(event.target.value as ExportFormat)}>
                        <option value="csv">CSV</option><option value="tsv">TSV</option><option value="json">JSON</option>
                        <option value="sql">SQL INSERT</option><option value="markdown">Markdown</option>
                        <option value="html">HTML</option><option value="xlsx">Excel XLSX</option>
                    </select></label>
                    <fieldset><legend>Scope</legend>
                        <label><input type="radio" checked={scope === 'selection'} disabled={!selection} onChange={() => setScope('selection')} /> Selected cells</label>
                        <label><input type="radio" checked={scope === 'page'} onChange={() => setScope('page')} /> Current page</label>
                        <label><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All filtered rows</label>
                    </fieldset>
                </div>
                {status && <div className="dialog-status busy">{status}</div>}
                <div className="modal-buttons"><div className="spacer" />
                    <button onClick={() => { if (busy) cancelled.current = true; else onClose() }}>{busy ? 'Cancel export' : 'Cancel'}</button>
                    <button className="primary" disabled={busy} onClick={run}>Export</button>
                </div>
            </div>
        </div>
    )
}
