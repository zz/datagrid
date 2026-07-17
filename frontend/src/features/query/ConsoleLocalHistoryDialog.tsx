import { useMemo, useState } from 'react'
import { Clock3, GitCompare, RotateCcw, Trash2, X } from 'lucide-react'
import { Tab } from '../../store'
import { clearConsoleRevisions, ConsoleRevision, deleteConsoleRevision, diffLines, loadConsoleRevisions } from './consoleLocalHistory'

function revisionLabel(reason: ConsoleRevision['reason']) {
    if (reason === 'executed') return 'Executed'
    if (reason === 'restore-point') return 'Before restore'
    return 'Edited'
}

export default function ConsoleLocalHistoryDialog({ tab, onClose, onRestore }: {
    tab: Tab
    onClose: () => void
    onRestore: (revision: ConsoleRevision) => void
}) {
    const [revisions, setRevisions] = useState(() => loadConsoleRevisions(tab.id))
    const [selectedId, setSelectedId] = useState(() => revisions[0]?.id ?? '')
    const selected = revisions.find(revision => revision.id === selectedId) ?? revisions[0]
    const lines = useMemo(() => selected ? diffLines(selected.sql, tab.sql) : [], [selected, tab.sql])
    const added = lines.filter(line => line.kind === 'added').length
    const removed = lines.filter(line => line.kind === 'removed').length
    const remove = (revision: ConsoleRevision) => {
        deleteConsoleRevision(revision.id)
        const next = revisions.filter(item => item.id !== revision.id)
        setRevisions(next)
        if (selectedId === revision.id) setSelectedId(next[0]?.id ?? '')
    }
    const clear = () => {
        clearConsoleRevisions(tab.id)
        setRevisions([])
        setSelectedId('')
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
        <div className="modal console-history-dialog">
            <div className="console-history-title"><Clock3 size={16} /><div><h2>Local History</h2><span>{tab.title}</span></div><button className="icon-btn" onClick={onClose} title="Close"><X size={15} /></button></div>
            <div className="console-history-body">
                <aside className="console-revisions">
                    <div className="console-history-heading"><span>Revisions</span><button className="icon-btn" onClick={clear} disabled={!revisions.length} title="Clear local history"><Trash2 size={12} /></button></div>
                    {revisions.map(revision => <div className={`console-revision ${revision.id === selected?.id ? 'active' : ''}`} key={revision.id} onClick={() => setSelectedId(revision.id)}>
                        <button><strong>{new Date(revision.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</strong><span>{revisionLabel(revision.reason)} · {revision.sql.split('\n').length} lines</span></button>
                        <button className="icon-btn" onClick={event => { event.stopPropagation(); remove(revision) }} title="Delete revision"><Trash2 size={12} /></button>
                    </div>)}
                    {!revisions.length && <div className="console-history-empty">No local revisions yet.</div>}
                </aside>
                <section className="console-history-diff">
                    <div className="console-history-heading"><span><GitCompare size={12} /> Revision compared with current editor</span>{selected && <small><b>+{added}</b> <i>-{removed}</i></small>}</div>
                    <div className="console-diff-lines">
                        {lines.map((line, index) => <div className={`console-diff-line ${line.kind}`} key={`${index}:${line.kind}`}><span>{line.oldLine ?? ''}</span><span>{line.newLine ?? ''}</span><b>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</b><code>{line.text || ' '}</code></div>)}
                        {!selected && <div className="console-history-empty">Edit this console for a few seconds to create its first revision.</div>}
                    </div>
                </section>
            </div>
            <div className="modal-buttons"><span>{revisions.length} revision{revisions.length === 1 ? '' : 's'} retained locally</span><div className="spacer" /><button onClick={onClose}>Close</button><button className="primary" disabled={!selected || selected.sql === tab.sql} onClick={() => selected && onRestore(selected)}><RotateCcw size={13} /> Restore Revision</button></div>
        </div>
    </div>
}
