import { useEffect, useRef, useState } from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { Column } from '../../ipc/types'
import { isBooleanResultColumn, isNumericResultColumn, isTemporalResultColumn, normalizeResultColumnFormat, type ResultColumnFormat, type ResultColumnFormats } from './resultColumnFormatting'

export default function ResultColumnFormatControl({ columns, columnIds, formats, onChange, onOpen }: {
    columns: Column[]
    columnIds: string[]
    formats: ResultColumnFormats
    onChange: (formats: ResultColumnFormats) => void
    onOpen?: () => void
}) {
    const root = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const [columnIndex, setColumnIndex] = useState(0)
    const column = columns[columnIndex]
    const id = columnIds[columnIndex]
    const format = formats[id] ?? {}
    useEffect(() => setColumnIndex(index => Math.min(index, Math.max(0, columns.length - 1))), [columns.length])
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
    const update = (patch: Partial<ResultColumnFormat>) => {
        if (!id) return
        const next = normalizeResultColumnFormat({ ...format, ...patch })
        const formatsNext = { ...formats }
        if (Object.keys(next).length) formatsNext[id] = next
        else delete formatsNext[id]
        onChange(formatsNext)
    }
    const resetColumn = () => {
        if (!id) return
        const next = { ...formats }
        delete next[id]
        onChange(next)
    }
    const configured = Object.keys(formats).length

    return <div className="result-format-control" ref={root}>
        <button className={`icon-btn ${open ? 'active' : ''}`} onClick={() => setOpen(current => { if (!current) onOpen?.(); return !current })} title="Column display formats"><SlidersHorizontal size={13} /></button>
        {open && <div className="result-format-menu">
            <div className="result-layout-heading"><SlidersHorizontal size={12} /><span>Display formats{configured ? ` · ${configured}` : ''}</span><button className="icon-btn" onClick={() => onChange({})} disabled={!configured} title="Reset all display formats"><RotateCcw size={11} /></button></div>
            <label><span>Column</span><select value={columnIndex} onChange={event => setColumnIndex(Number(event.target.value))}>{columns.map((item, index) => <option value={index} key={columnIds[index]}>{item.name}</option>)}</select></label>
            {column && isNumericResultColumn(column) && <><label><span>Number</span><select value={format.number ?? 'raw'} onChange={event => update({ number: event.target.value as ResultColumnFormat['number'], decimals: event.target.value === 'raw' ? undefined : format.decimals })}><option value="raw">Raw</option><option value="locale">Locale</option><option value="fixed">Fixed decimal</option></select></label>{format.number && format.number !== 'raw' && <label><span>Decimal places</span><input type="number" min={0} max={10} value={format.decimals ?? 2} onChange={event => update({ decimals: Number(event.target.value) })} /></label>}</>}
            {column && isTemporalResultColumn(column) && <label><span>Date and time</span><select value={format.date ?? 'raw'} onChange={event => update({ date: event.target.value as ResultColumnFormat['date'] })}><option value="raw">Raw</option><option value="date">Locale date</option><option value="datetime">Locale date and time</option><option value="iso">ISO 8601</option></select></label>}
            {column && isBooleanResultColumn(column) && <label><span>Boolean</span><select value={format.boolean ?? 'raw'} onChange={event => update({ boolean: event.target.value as ResultColumnFormat['boolean'] })}><option value="raw">Checkbox / raw</option><option value="yes-no">Yes / No</option></select></label>}
            <label><span>NULL label</span><input value={format.nullText ?? 'NULL'} maxLength={40} onChange={event => update({ nullText: event.target.value })} /></label>
            <label><span>Maximum characters</span><input type="number" min={8} max={100000} placeholder="Unlimited" value={format.maxLength ?? ''} onChange={event => update({ maxLength: event.target.value ? Number(event.target.value) : null })} /></label>
            <div className="result-format-actions"><button onClick={resetColumn} disabled={!id || !formats[id]}><RotateCcw size={11} /> Reset column</button></div>
        </div>}
    </div>
}
