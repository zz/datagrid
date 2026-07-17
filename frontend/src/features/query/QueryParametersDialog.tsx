import { useState } from 'react'

export default function QueryParametersDialog({
    names,
    initial,
    onCancel,
    onRun,
}: {
    names: string[]
    initial: Record<string, string>
    onCancel: () => void
    onRun: (values: Record<string, string>) => void
}) {
    const [values, setValues] = useState(() => Object.fromEntries(names.map(name => [name, initial[name] ?? ''])))
    return (
        <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
            <div className="modal query-parameters-dialog">
                <h2>Query Parameters</h2>
                <div className="parameter-list">
                    {names.map((name, index) => (
                        <label key={name}>
                            <code>:{name}</code>
                            <input
                                autoFocus={index === 0}
                                value={values[name]}
                                onChange={event => setValues(current => ({ ...current, [name]: event.target.value }))}
                                onKeyDown={event => event.key === 'Enter' && onRun(values)}
                            />
                        </label>
                    ))}
                </div>
                <div className="modal-buttons">
                    <div className="spacer" />
                    <button onClick={onCancel}>Cancel</button>
                    <button className="primary" onClick={() => onRun(values)}>Run</button>
                </div>
            </div>
        </div>
    )
}
