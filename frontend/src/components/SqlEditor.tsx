import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { Compartment, Prec } from '@codemirror/state'
import { sql, MySQL, PostgreSQL } from '@codemirror/lang-sql'

interface Props {
    engine: string // 'postgres' | 'mysql'
    // "schema.table" → columns; fed into dialect-aware autocomplete.
    schema?: Record<string, string[]>
    defaultSchema?: string
    initialSql: string
    onChange: (sql: string) => void
    // Run the current selection if any, else the whole document (⌘⏎).
    onRun: (statement: string) => void
}

function sqlExtension({ engine, schema, defaultSchema }: Pick<Props, 'engine' | 'schema' | 'defaultSchema'>) {
    return sql({
        dialect: engine === 'mysql' ? MySQL : PostgreSQL,
        schema,
        defaultSchema,
    })
}

export default function SqlEditor({ engine, schema, defaultSchema, initialSql, onChange, onRun }: Props) {
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
            doc: initialSql,
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
        // The editor owns the document after mount; initialSql is only the
        // seed, and schema updates arrive via the compartment below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Swap the SQL extension in place when the schema map (or engine) changes.
    useEffect(() => {
        view.current?.dispatch({
            effects: langCompartment.current.reconfigure(sqlExtension({ engine, schema, defaultSchema })),
        })
    }, [engine, schema, defaultSchema])

    return <div className="sql-editor" ref={host} />
}
