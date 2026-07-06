import { useState } from 'react'

// NameDialog is a small text-entry modal (a reliable replacement for
// window.prompt, which the webview may not support).
export default function NameDialog({
    title,
    value,
    onSubmit,
    onCancel,
}: {
    title: string
    value: string
    onSubmit: (v: string) => void
    onCancel: () => void
}) {
    const [v, setV] = useState(value)
    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
            <div className="modal name-dialog">
                <h2>{title}</h2>
                <input
                    autoFocus
                    value={v}
                    onChange={e => setV(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') onSubmit(v)
                        if (e.key === 'Escape') onCancel()
                    }}
                />
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onCancel}>Cancel</button>
                    <button className="primary" onClick={() => onSubmit(v)}>
                        OK
                    </button>
                </div>
            </div>
        </div>
    )
}
