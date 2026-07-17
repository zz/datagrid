export interface SourceChangeSummary {
    added: number
    removed: number
    changed: number
}

export function sourceChangeSummary(original: string, current: string): SourceChangeSummary {
    const before = original.split('\n')
    const after = current.split('\n')
    let changed = 0
    const shared = Math.min(before.length, after.length)
    for (let index = 0; index < shared; index++) if (before[index] !== after[index]) changed++
    return { changed, added: Math.max(0, after.length - before.length), removed: Math.max(0, before.length - after.length) }
}
