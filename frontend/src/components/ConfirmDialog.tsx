// ConfirmDialog is an in-app confirmation modal — a reliable replacement for
// window.confirm, which (like window.prompt) the webview may not support.
export default function ConfirmDialog({
    title,
    message,
    confirmLabel = 'Confirm',
    danger = false,
    onConfirm,
    onCancel,
}: {
    title: string
    message: string
    confirmLabel?: string
    danger?: boolean
    onConfirm: () => void
    onCancel: () => void
}) {
    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
            <div className={`modal ${danger ? 'modal-warn' : ''}`}>
                <h2>{title}</h2>
                <p>{message}</p>
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onCancel}>Cancel</button>
                    <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    )
}
