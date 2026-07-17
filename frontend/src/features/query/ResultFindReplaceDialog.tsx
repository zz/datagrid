import { useMemo, useState } from 'react'
import { ReplaceAll } from 'lucide-react'
import type { Column, Value } from '../../ipc/types'
import { buildResultReplacements, ResultReplaceSelection } from './resultReplace'

export default function ResultFindReplaceDialog({ columns, rows, sourceRowIndexes, visibleColumnIndexes, excludedSourceRows, selection, onCancel, onApply }: {
    columns: Column[]
    rows: Value[][]
    sourceRowIndexes: number[]
    visibleColumnIndexes: number[]
    excludedSourceRows: Set<number>
    selection: ResultReplaceSelection
    onCancel: () => void
    onApply: (edits: Array<{ rowIndex: number; columnIndex: number; text: string; isNull: boolean }>) => void
}) {
    const [find, setFind] = useState('')
    const [replace, setReplace] = useState('')
    const [matchCase, setMatchCase] = useState(false)
    const [wholeCell, setWholeCell] = useState(false)
    const hasSelection = selection.ranges.length > 0 || selection.rows.length > 0 || selection.columns.length > 0
    const [selectionOnly, setSelectionOnly] = useState(hasSelection)
    const replacements = useMemo(() => buildResultReplacements(rows, sourceRowIndexes, visibleColumnIndexes, selection, { find, replace, matchCase, wholeCell, selectionOnly }, excludedSourceRows), [excludedSourceRows, find, matchCase, replace, rows, selection, selectionOnly, sourceRowIndexes, visibleColumnIndexes, wholeCell])
    const counts = useMemo(() => {
        const result = new Map<number, number>()
        replacements.forEach(item => result.set(item.columnIndex, (result.get(item.columnIndex) ?? 0) + 1))
        return [...result.entries()]
    }, [replacements])

    const apply = () => {
        if (!replacements.length) return
        onApply(replacements.map(({ rowIndex, columnIndex, text, isNull }) => ({ rowIndex, columnIndex, text, isNull })))
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
        <div className="modal result-replace-dialog" role="dialog" aria-modal="true" aria-label="Find and replace in results">
            <div className="result-replace-title"><ReplaceAll size={17} /><div><h2>Find and Replace</h2><span>{rows.length.toLocaleString()} loaded rows</span></div></div>
            <div className="result-replace-inputs"><label>Find<input autoFocus value={find} onChange={event => setFind(event.target.value)} /></label><label>Replace<input value={replace} onChange={event => setReplace(event.target.value)} /></label></div>
            <div className="result-replace-options"><label><input type="checkbox" checked={matchCase} onChange={event => setMatchCase(event.target.checked)} /> Match case</label><label><input type="checkbox" checked={wholeCell} onChange={event => setWholeCell(event.target.checked)} /> Whole cell</label><label>Scope<select value={selectionOnly && hasSelection ? 'selection' : 'loaded'} onChange={event => setSelectionOnly(event.target.value === 'selection')}><option value="loaded">Loaded visible cells</option><option value="selection" disabled={!hasSelection}>Selection</option></select></label></div>
            <div className="result-replace-summary"><strong>{replacements.length.toLocaleString()} replacements</strong>{counts.map(([columnIndex, count]) => <span key={columnIndex}>{columns[columnIndex]?.name} <b>{count}</b></span>)}</div>
            <div className="result-replace-preview">{replacements.slice(0, 100).map((item, index) => <div key={`${item.rowIndex}:${item.columnIndex}:${index}`}><span>Row {item.rowIndex + 1}</span><strong>{columns[item.columnIndex]?.name}</strong><code>{item.before}</code><code>{item.text}</code></div>)}{find && replacements.length === 0 && <div className="result-replace-empty">No matches.</div>}{replacements.length > 100 && <div className="result-replace-more">{(replacements.length - 100).toLocaleString()} more replacements</div>}</div>
            <div className="modal-buttons"><div className="spacer" /><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!replacements.length} onClick={apply}>Replace All</button></div>
        </div>
    </div>
}
