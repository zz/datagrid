import { useEffect, useRef, useState } from 'react'
import { useApp, Tab } from '../../store'

export default function RedisRepl({ tab }: { tab: Tab }) {
    const view = useApp(s => s.redisViews[tab.id])
    const { redisRunCommand } = useApp()
    const [input, setInput] = useState('')
    const scroller = useRef<HTMLDivElement>(null)

    useEffect(() => {
        scroller.current?.scrollTo(0, scroller.current.scrollHeight)
    }, [view?.repl.length])

    if (!view) return null

    const submit = () => {
        if (!input.trim()) return
        redisRunCommand(tab.id, input)
        setInput('')
    }

    return (
        <div className="redis-repl">
            <div className="repl-output" ref={scroller}>
                {view.repl.length === 0 && (
                    <div className="redis-empty">
                        Raw command REPL on db{view.db}. Try <code>PING</code> or <code>INFO server</code>.
                    </div>
                )}
                {view.repl.map((line, i) => (
                    <div key={i} className="repl-entry">
                        <div className="repl-cmd">
                            <span className="repl-prompt">db{view.db}&gt;</span> {line.command}
                        </div>
                        <pre className={`repl-reply ${line.error ? 'error' : ''}`}>{line.text}</pre>
                    </div>
                ))}
            </div>
            <div className="repl-input">
                <span className="repl-prompt">db{view.db}&gt;</span>
                <input
                    autoFocus
                    value={input}
                    placeholder="command…"
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                />
            </div>
        </div>
    )
}
