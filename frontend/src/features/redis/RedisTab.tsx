import { useState } from 'react'
import { useApp, Tab } from '../../store'
import RedisValueView from './RedisValueView'
import RedisRepl from './RedisRepl'

const TYPE_FILTERS = ['', 'string', 'list', 'set', 'hash', 'zset', 'stream']

function ttlLabel(ttl: number): string {
    if (ttl < 0) return '∞'
    if (ttl < 120) return `${ttl}s`
    if (ttl < 7200) return `${Math.round(ttl / 60)}m`
    return `${Math.round(ttl / 3600)}h`
}

export default function RedisTab({ tab }: { tab: Tab }) {
    const view = useApp(s => s.redisViews[tab.id])
    const { redisScan, redisSetDb, redisSetPattern, redisSelectKey, redisDeleteKey } = useApp()
    const [confirmDel, setConfirmDel] = useState<string | null>(null)
    const [showRepl, setShowRepl] = useState(false)

    if (!view) return null

    const dbOptions = view.databases.length
        ? view.databases
        : Array.from({ length: 16 }, (_, i) => ({ index: i, keys: 0 }))

    return (
        <div className="redis-tab">
            <div className="redis-toolbar">
                <label>DB</label>
                <select value={view.db} onChange={e => redisSetDb(tab.id, parseInt(e.target.value, 10))}>
                    {dbOptions.map(d => (
                        <option key={d.index} value={d.index}>
                            db{d.index} ({d.keys})
                        </option>
                    ))}
                </select>
                <input
                    className="redis-pattern"
                    placeholder="match pattern, e.g. user:*"
                    value={view.pattern}
                    onChange={e => redisSetPattern(tab.id, e.target.value, view.typeFilter)}
                    onKeyDown={e => e.key === 'Enter' && redisScan(tab.id, true)}
                />
                <select value={view.typeFilter} onChange={e => redisSetPattern(tab.id, view.pattern, e.target.value)}>
                    {TYPE_FILTERS.map(t => (
                        <option key={t} value={t}>
                            {t === '' ? 'all types' : t}
                        </option>
                    ))}
                </select>
                <button onClick={() => redisScan(tab.id, true)} disabled={view.loading}>
                    Scan
                </button>
                <span className="tb-spacer" />
                <button className={showRepl ? 'active' : ''} onClick={() => setShowRepl(v => !v)}>
                    ›_ REPL
                </button>
            </div>

            {view.error && <div className="redis-error">{view.error}</div>}

            <div className="redis-body">
                <div className="redis-keylist">
                    {view.keys.length === 0 && !view.loading && (
                        <div className="redis-empty">No keys. Adjust the pattern and Scan.</div>
                    )}
                    {view.keys.map(k => (
                        <div
                            key={k.key}
                            className={`redis-key ${view.selectedKey === k.key ? 'selected' : ''}`}
                            onClick={() => redisSelectKey(tab.id, k.key)}
                        >
                            <span className={`redis-type type-${k.type}`}>{k.type}</span>
                            <span className="redis-keyname">{k.key}</span>
                            <span className="redis-ttl">{ttlLabel(k.ttl)}</span>
                            <span
                                className={`redis-del ${confirmDel === k.key ? 'armed' : ''}`}
                                title={confirmDel === k.key ? 'Click again to delete' : 'Delete key'}
                                onClick={e => {
                                    e.stopPropagation()
                                    if (confirmDel === k.key) {
                                        setConfirmDel(null)
                                        redisDeleteKey(tab.id, k.key)
                                    } else {
                                        setConfirmDel(k.key)
                                    }
                                }}
                            >
                                ×
                            </span>
                        </div>
                    ))}
                    {view.hasMore && (
                        <button className="redis-more" onClick={() => redisScan(tab.id, false)} disabled={view.loading}>
                            {view.loading ? 'Loading…' : 'Load more'}
                        </button>
                    )}
                </div>

                <div className="redis-detail">
                    {showRepl ? (
                        <RedisRepl tab={tab} />
                    ) : view.value ? (
                        <RedisValueView tab={tab} value={view.value} />
                    ) : (
                        <div className="redis-empty">Select a key to view its value.</div>
                    )}
                </div>
            </div>
        </div>
    )
}
