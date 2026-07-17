import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type { Column, Value } from '../../ipc/types'
import { exportRows, ExportFormat } from '../../export'
import { queryResultExportData, QueryResultExportScope } from './queryResultExport'
import type { ResultRange } from './resultSelection'

export default function QueryResultExportDialog({ baseName, columns, rows, shownRows, visibleColumnIndexes, selection, sqlTable, engine, truncated, onClose }: {
    baseName: string
    columns: Column[]
    rows: Value[][]
    shownRows: Value[][]
    visibleColumnIndexes: number[]
    selection?: ResultRange
    sqlTable?: string
    engine: string
    truncated: boolean
    onClose: () => void
}) {
    const [format, setFormat] = useState<ExportFormat>('csv')
    const [scope, setScope] = useState<QueryResultExportScope>(selection ? 'selection' : 'visible')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const data = useMemo(() => queryResultExportData(scope, columns, rows, shownRows, visibleColumnIndexes, selection), [columns, rows, scope, selection, shownRows, visibleColumnIndexes])

    const run = async () => {
        if (!data?.columns.length) return
        setBusy(true); setError('')
        try {
            await exportRows(baseName, format, data.columns, data.rows, sqlTable ?? baseName, engine)
            onClose()
        } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
        <div className="modal export-dialog query-result-export-dialog" role="dialog" aria-modal="true" aria-label="Export query results">
            <h2><Download size={17} /> Export Query Result</h2>
            <div className="export-options query-result-export-options"><label>Format<select value={format} onChange={event => setFormat(event.target.value as ExportFormat)}><option value="csv">CSV</option><option value="tsv">TSV</option><option value="json">JSON</option><option value="sql" disabled={!sqlTable}>SQL INSERT</option><option value="markdown">Markdown</option><option value="html">HTML</option><option value="xlsx">Excel XLSX</option></select></label><fieldset><legend>Scope</legend><label><input type="radio" checked={scope === 'selection'} disabled={!selection} onChange={() => setScope('selection')} /> Selected cells</label><label><input type="radio" checked={scope === 'visible'} onChange={() => setScope('visible')} /> Visible result</label><label><input type="radio" checked={scope === 'loaded'} onChange={() => setScope('loaded')} /> Complete loaded result</label></fieldset></div>
            {data && <div className="query-result-export-summary"><strong>{data.rows.length.toLocaleString()}</strong><span>rows</span><strong>{data.columns.length.toLocaleString()}</strong><span>columns</span><strong>{(data.rows.length * data.columns.length).toLocaleString()}</strong><span>cells</span></div>}
            {truncated && scope === 'loaded' && <div className="migration-warning">The query reached its row limit. This export contains every row currently loaded.</div>}
            {error && <div className="dialog-status err">{error}</div>}
            <div className="modal-buttons"><div className="spacer" /><button onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy || !data?.columns.length} onClick={() => void run()}>{busy ? 'Exporting' : 'Export'}</button></div>
        </div>
    </div>
}
