import { EventsOn } from '../../wailsjs/runtime/runtime'
import type { RowBatch, QuerySummary } from './types'

// Event names match internal/api (EvQueryBatch / EvQueryDone).
export function onQueryBatch(cb: (b: RowBatch) => void): () => void {
    return EventsOn('query:batch', cb)
}

export function onQueryDone(cb: (s: QuerySummary) => void): () => void {
    return EventsOn('query:done', cb)
}
