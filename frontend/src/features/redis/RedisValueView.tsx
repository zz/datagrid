import { useEffect, useState } from 'react'
import { useApp, Tab } from '../../store'
import { drivers } from '../../../wailsjs/go/models'

function ttlToText(ttl: number): string {
    return ttl < 0 ? '' : String(ttl)
}

export default function RedisValueView({ tab, value }: { tab: Tab; value: drivers.RedisValue }) {
    const { redisSaveString, redisSaveTTL } = useApp()
    const [draft, setDraft] = useState(value.string ?? '')
    const [ttlDraft, setTtlDraft] = useState(ttlToText(value.ttl))

    // Reset local drafts whenever a different key/value loads.
    useEffect(() => {
        setDraft(value.string ?? '')
        setTtlDraft(ttlToText(value.ttl))
    }, [value.key, value.string, value.ttl])

    const stringDirty = value.type === 'string' && draft !== (value.string ?? '')
    const ttlDirty = ttlDraft !== ttlToText(value.ttl)

    return (
        <div className="redis-value">
            <div className="redis-value-header">
                <span className={`redis-type type-${value.type}`}>{value.type}</span>
                <span className="redis-value-key">{value.key}</span>
                {value.truncated && <span className="redis-trunc">truncated</span>}
            </div>

            <div className="redis-ttl-row">
                <label>TTL (seconds, blank = no expiry)</label>
                <input value={ttlDraft} onChange={e => setTtlDraft(e.target.value.replace(/[^0-9]/g, ''))} />
                <button
                    disabled={!ttlDirty}
                    onClick={() => redisSaveTTL(tab.id, ttlDraft === '' ? -1 : parseInt(ttlDraft, 10))}
                >
                    Set TTL
                </button>
            </div>

            {value.type === 'string' && (
                <div className="redis-string-edit">
                    <textarea value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} />
                    <div className="redis-string-actions">
                        <button disabled={!stringDirty} onClick={() => setDraft(value.string ?? '')}>
                            Reset
                        </button>
                        <button className="primary" disabled={!stringDirty} onClick={() => redisSaveString(tab.id, draft)}>
                            Save
                        </button>
                    </div>
                </div>
            )}

            {value.type === 'list' && (
                <ol className="redis-coll">
                    {value.list?.map((v, i) => (
                        <li key={i}>{v}</li>
                    ))}
                </ol>
            )}

            {value.type === 'set' && (
                <ul className="redis-coll">
                    {value.set?.map((v, i) => (
                        <li key={i}>{v}</li>
                    ))}
                </ul>
            )}

            {value.type === 'hash' && (
                <table className="redis-kv-table">
                    <tbody>
                        {Object.entries(value.hash ?? {}).map(([k, v]) => (
                            <tr key={k}>
                                <td className="redis-kv-key">{k}</td>
                                <td>{v}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {value.type === 'zset' && (
                <table className="redis-kv-table">
                    <tbody>
                        {value.zset?.map((z, i) => (
                            <tr key={i}>
                                <td className="redis-kv-key">{z.score}</td>
                                <td>{z.member}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {value.type === 'stream' && (
                <table className="redis-kv-table">
                    <tbody>
                        {value.stream?.map(e => (
                            <tr key={e.id}>
                                <td className="redis-kv-key">{e.id}</td>
                                <td>{JSON.stringify(e.fields)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}
