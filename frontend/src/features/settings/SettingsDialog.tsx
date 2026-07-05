import { useSettings, Theme } from '../../settings'

const THEMES: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
]

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
    const { theme, pageSize, rowLimit, update } = useSettings()

    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal">
                <h2>Settings</h2>
                <div className="form-grid">
                    <label>Theme</label>
                    <div className="theme-toggle">
                        {THEMES.map(t => (
                            <button
                                key={t.value}
                                className={theme === t.value ? 'on' : ''}
                                onClick={() => update({ theme: t.value })}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <label>Table page size</label>
                    <input
                        type="number"
                        value={pageSize}
                        min={10}
                        max={5000}
                        onChange={e => update({ pageSize: Math.max(10, parseInt(e.target.value, 10) || 200) })}
                    />
                    <label>Query row limit</label>
                    <input
                        type="number"
                        value={rowLimit}
                        min={100}
                        max={1000000}
                        onChange={e => update({ rowLimit: Math.max(100, parseInt(e.target.value, 10) || 10000) })}
                    />
                </div>
                <p className="settings-note">
                    Page size and row limit apply to newly loaded tables and queries.
                </p>
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button className="primary" onClick={onClose}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    )
}
