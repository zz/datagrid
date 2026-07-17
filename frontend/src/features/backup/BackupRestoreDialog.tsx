import { useState } from 'react'
import { Archive, CheckCircle2, DatabaseBackup, RotateCcw } from 'lucide-react'
import { BackupDatabase, RestoreDatabase } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import ConfirmDialog from '../../components/ConfirmDialog'

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function BackupRestoreDialog({ connection, onClose, onError }: {
    connection: drivers.ConnectionConfig
    onClose: () => void
    onError: (error: string) => void
}) {
    const [format, setFormat] = useState(connection.engine === 'postgres' ? 'custom' : 'plain')
    const [clean, setClean] = useState(false)
    const [running, setRunning] = useState<'backup' | 'restore' | null>(null)
    const [confirmRestore, setConfirmRestore] = useState(false)
    const [result, setResult] = useState<{ action: string; path: string; size: number } | null>(null)
    const unsupportedTunnel = !!connection.ssh

    const backup = async () => {
        setRunning('backup'); setResult(null)
        try {
            const response = await BackupDatabase(connection.id, format)
            if (response?.path) setResult({ action: 'Backup created', path: response.path, size: response.size })
        } catch (error) { onError(String(error)) } finally { setRunning(null) }
    }
    const restore = async () => {
        setConfirmRestore(false); setRunning('restore'); setResult(null)
        try {
            const response = await RestoreDatabase(connection.id, clean)
            if (response?.path) setResult({ action: 'Restore completed from', path: response.path, size: response.size })
        } catch (error) { onError(String(error)) } finally { setRunning(null) }
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !running && onClose()}>
        <div className="modal backup-dialog">
            <div className="backup-title"><DatabaseBackup size={18} /><div><h2>Backup & Restore</h2><span>{connection.name} / {connection.database}</span></div></div>
            <div className="backup-sections">
                <section><div className="backup-section-title"><Archive size={16} /><div><strong>Create Backup</strong><span>Export schema and data using the native {connection.engine === 'postgres' ? 'pg_dump' : 'mysqldump'} tool.</span></div></div>
                    {connection.engine === 'postgres' && <label className="backup-option">Format<select value={format} onChange={event => setFormat(event.target.value)}><option value="custom">Custom archive (.dump)</option><option value="plain">Plain SQL (.sql)</option></select></label>}
                    <button className="primary backup-action" disabled={!!running || unsupportedTunnel} onClick={() => void backup()}>{running === 'backup' ? 'Creating backup...' : 'Choose Destination & Back Up'}</button>
                </section>
                <section><div className="backup-section-title"><RotateCcw size={16} /><div><strong>Restore Backup</strong><span>Apply a SQL script or PostgreSQL custom archive to this database.</span></div></div>
                    {connection.engine === 'postgres' && <label className="backup-check"><input type="checkbox" checked={clean} onChange={event => setClean(event.target.checked)} /><span><strong>Clean existing objects</strong><small>For custom archives, drop matching objects before restoring.</small></span></label>}
                    <button className="danger backup-action" disabled={!!running || connection.readOnly || unsupportedTunnel} onClick={() => setConfirmRestore(true)}>{running === 'restore' ? 'Restoring...' : 'Choose Backup & Restore'}</button>
                </section>
            </div>
            {unsupportedTunnel && <div className="migration-warning">Native backup tools do not yet support this connection’s SSH tunnel.</div>}
            {connection.readOnly && <div className="migration-warning">Restore is disabled because this connection is read-only. Backup remains available.</div>}
            {result && <div className="backup-result"><CheckCircle2 size={14} /><div><strong>{result.action}</strong><span title={result.path}>{result.path}</span></div><b>{formatBytes(result.size)}</b></div>}
            <div className="modal-buttons"><span>Requires PostgreSQL or MySQL command-line client tools on PATH.</span><div className="spacer" /><button onClick={onClose} disabled={!!running}>Close</button></div>
        </div>
        {confirmRestore && <ConfirmDialog title={`Restore into “${connection.database}”?`} message="The selected backup will execute against the current database and may overwrite data or database objects. This operation cannot be automatically undone." confirmLabel="Choose File & Restore" danger onCancel={() => setConfirmRestore(false)} onConfirm={() => void restore()} />}
    </div>
}
