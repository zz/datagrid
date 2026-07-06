import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { Compartment, Prec } from '@codemirror/state'
import { sql, MySQL, PostgreSQL } from '@codemirror/lang-sql'
import { CompletionContext, Completion, CompletionResult } from '@codemirror/autocomplete'

interface Props {
    engine: string // 'postgres' | 'mysql'
    // "schema.table" → columns; fed into dialect-aware autocomplete.
    schema?: Record<string, string[]>
    defaultSchema?: string
    // Source-of-truth content. The editor owns typing, but external changes
    // (Format, load-from-history) are pushed in when they differ from the doc.
    value: string
    onChange: (sql: string) => void
    // Run the current selection if any, else the whole document (⌘⏎).
    onRun: (statement: string) => void
}

// CodeMirror's lang-sql resolves columns from a nested namespace
// ({schema: {table: [cols]}}), not the flat "schema.table" → cols map we get
// from the backend. Convert so column completion works after a qualified table.
type Namespace = Record<string, string[] | Record<string, string[]>>
function toNamespace(flat?: Record<string, string[]>): Namespace | undefined {
    if (!flat) return undefined
    const ns: Namespace = {}
    for (const [key, cols] of Object.entries(flat)) {
        const dot = key.indexOf('.')
        if (dot === -1) {
            ns[key] = cols
            continue
        }
        const schema = key.slice(0, dot)
        const table = key.slice(dot + 1)
        const bucket = (ns[schema] ??= {}) as Record<string, string[]>
        bucket[table] = cols
    }
    return ns
}

// columnCompletionSource offers column names for a bare identifier (e.g. in a
// WHERE clause). lang-sql's own schema completion only surfaces a table's
// columns after "table."/"alias.", not for FROM-clause columns typed bare, so
// this supplements it with a deduped list of all columns (table shown as
// detail). Table-qualified completion and keywords still come from lang-sql.
function columnCompletionSource(flat?: Record<string, string[]>) {
    const byCol = new Map<string, Set<string>>()
    for (const [key, cols] of Object.entries(flat ?? {})) {
        const table = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key
        for (const c of cols) {
            if (!byCol.has(c)) byCol.set(c, new Set())
            byCol.get(c)!.add(table)
        }
    }
    const options: Completion[] = [...byCol.entries()].map(([col, tables]) => ({
        label: col,
        type: 'property',
        detail: [...tables].slice(0, 3).join(', '),
    }))
    return (context: CompletionContext): CompletionResult | null => {
        const word = context.matchBefore(/[\w]+/)
        if (!word || (word.from === word.to && !context.explicit)) return null
        return { from: word.from, options, validFor: /^\w*$/ }
    }
}

function sqlExtension({ engine, schema, defaultSchema }: Pick<Props, 'engine' | 'schema' | 'defaultSchema'>) {
    const support = sql({
        dialect: engine === 'mysql' ? MySQL : PostgreSQL,
        schema: toNamespace(schema),
        defaultSchema,
    })
    // Register the column source as an extra autocomplete source for SQL.
    return [support, support.language.data.of({ autocomplete: columnCompletionSource(schema) })]
}

export default function SqlEditor({ engine, schema, defaultSchema, value, onChange, onRun }: Props) {
    const host = useRef<HTMLDivElement>(null)
    const view = useRef<EditorView | null>(null)
    const langCompartment = useRef(new Compartment())
    // Keep latest callbacks without rebuilding the editor.
    const cbs = useRef({ onChange, onRun })
    cbs.current = { onChange, onRun }

    useEffect(() => {
        if (!host.current) return
        const runCurrent = (v: EditorView) => {
            const { from, to } = v.state.selection.main
            const stmt = from === to ? v.state.doc.toString() : v.state.sliceDoc(from, to)
            cbs.current.onRun(stmt)
            return true
        }
        const ed = new EditorView({
            doc: value,
            parent: host.current,
            extensions: [
                basicSetup,
                langCompartment.current.of(sqlExtension({ engine, schema, defaultSchema })),
                Prec.highest(keymap.of([{ key: 'Mod-Enter', run: runCurrent }])),
                EditorView.updateListener.of(u => {
                    if (u.docChanged) cbs.current.onChange(u.state.doc.toString())
                }),
                EditorView.theme({
                    '&': { height: '100%', fontSize: '13px' },
                    '.cm-scroller': { fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' },
                }),
            ],
        })
        view.current = ed
        return () => ed.destroy()
        // The editor owns the document after mount; `value` seeds it and the
        // sync effect below reconciles external changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Push external value changes (Format, load-from-history) into the doc,
    // but only when they differ — so this never fights the user's typing
    // (typing updates `value` via onChange, keeping them equal).
    useEffect(() => {
        const ed = view.current
        if (!ed) return
        const current = ed.state.doc.toString()
        if (current !== value) {
            ed.dispatch({ changes: { from: 0, to: current.length, insert: value } })
        }
    }, [value])

    // Swap the SQL extension in place when the schema map (or engine) changes.
    useEffect(() => {
        view.current?.dispatch({
            effects: langCompartment.current.reconfigure(sqlExtension({ engine, schema, defaultSchema })),
        })
    }, [engine, schema, defaultSchema])

    return <div className="sql-editor" ref={host} />
}
