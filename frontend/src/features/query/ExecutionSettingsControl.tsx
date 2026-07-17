import { useEffect, useRef, useState } from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { DEFAULT_EXECUTION_SETTINGS, QueryExecutionSettings } from './queryExecutionSettings'

export default function ExecutionSettingsControl({ value, globalRowLimit, onChange }: {
    value: QueryExecutionSettings
    globalRowLimit: number
    onChange: (settings: QueryExecutionSettings) => void
}) {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent && event.key === 'Escape') setOpen(false)
            else if (event instanceof MouseEvent && !root.current?.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', close)
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
    }, [open])

    const summary = value.timeoutSeconds > 0 ? `${value.timeoutSeconds}s` : value.rowLimit > 0 ? value.rowLimit.toLocaleString() : ''
    return <div className="execution-settings-wrap" ref={root}>
        <button className={open ? 'active' : ''} onClick={() => setOpen(state => !state)} title="Query execution settings"><SlidersHorizontal size={13} /> Execution {summary}</button>
        {open && <div className="execution-settings-menu">
            <div className="execution-settings-heading"><span>Execution Settings</span><button className="icon-btn" onClick={() => onChange(DEFAULT_EXECUTION_SETTINGS)} title="Reset execution settings"><RotateCcw size={12} /></button></div>
            <label><span><strong>Statement timeout</strong><small>0 disables the timeout</small></span><input type="number" min="0" max="3600" step="1" value={value.timeoutSeconds} onChange={event => onChange({ ...value, timeoutSeconds: Number(event.target.value) })} /><b>sec</b></label>
            <label><span><strong>Result row limit</strong><small>0 uses global limit ({globalRowLimit.toLocaleString()})</small></span><input type="number" min="0" max="1000000" step="100" value={value.rowLimit} onChange={event => onChange({ ...value, rowLimit: Number(event.target.value) })} /><b>rows</b></label>
            <label className="execution-confirm"><input type="checkbox" checked={value.confirmDestructive} onChange={event => onChange({ ...value, confirmDestructive: event.target.checked })} /><span><strong>Confirm unrestricted updates</strong><small>Warn before UPDATE or DELETE without WHERE</small></span></label>
        </div>}
    </div>
}
