import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { displayShortcut, WorkbenchCommand } from '../../commands'

export default function CommandPalette({ commands, onClose }: { commands: WorkbenchCommand[]; onClose: () => void }) {
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState(0)

    const matches = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return commands.filter(command => `${command.category} ${command.label}`.toLowerCase().includes(needle))
    }, [commands, query])

    const choose = (command: WorkbenchCommand) => {
        if (!command.enabled) return
        command.run()
        onClose()
    }

    return (
        <div className="modal-backdrop palette-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
            <div className="palette command-palette" role="dialog" aria-label="Find Action">
                <div className="command-palette-input">
                    <Search size={16} aria-hidden="true" />
                    <input
                        placeholder="Find action…"
                        value={query}
                        autoFocus
                        onChange={event => {
                            setQuery(event.target.value)
                            setSelected(0)
                        }}
                        onKeyDown={event => {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault()
                                setSelected(value => Math.min(value + 1, matches.length - 1))
                            } else if (event.key === 'ArrowUp') {
                                event.preventDefault()
                                setSelected(value => Math.max(value - 1, 0))
                            } else if (event.key === 'Enter' && matches[selected]) {
                                event.preventDefault()
                                choose(matches[selected])
                            } else if (event.key === 'Escape') {
                                onClose()
                            }
                        }}
                    />
                </div>
                <div className="palette-list">
                    {matches.length === 0 && <div className="palette-empty">No matching actions.</div>}
                    {matches.map((command, index) => {
                        const Icon = command.icon
                        return (
                            <button
                                key={command.id}
                                className={`command-item ${index === selected ? 'selected' : ''}`}
                                disabled={!command.enabled}
                                onMouseEnter={() => setSelected(index)}
                                onClick={() => choose(command)}
                            >
                                <Icon size={16} aria-hidden="true" />
                                <span>{command.label}</span>
                                <span className="command-category">{command.category}</span>
                                <kbd>{displayShortcut(command.shortcut)}</kbd>
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
