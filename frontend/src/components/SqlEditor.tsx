import { useEffect, useRef } from 'react'
import { Decoration, DecorationSet, EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, Prec, StateField } from '@codemirror/state'
import { sql, MySQL, PostgreSQL } from '@codemirror/lang-sql'
import { CompletionContext, Completion, CompletionResult } from '@codemirror/autocomplete'
import { Diagnostic, lintGutter, linter, lintKeymap } from '@codemirror/lint'
import { inspectSQL, resolveTableReference } from '../features/query/sqlDiagnostics'
import { renderSnippet, SQLSnippet } from '../features/query/sqlSnippets'
import { formatSQLEdit } from '../features/query/sqlFormatting'

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
    onOpenTable?: (schema: string, table: string) => void
    snippets?: SQLSnippet[]
    insertRequest?: { id: number; sql: string } | null
    bookmarkLines?: number[]
    navigateRequest?: { id: number; line: number } | null
    formatRequest?: { id: number } | null
    onFormatError?: (error: string) => void
    onCursorLineChange?: (line: number) => void
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
    return [
        support,
        support.language.data.of({ autocomplete: columnCompletionSource(schema) }),
        linter(view => inspectSQL(view.state.doc.toString(), schema, defaultSchema).map(item => {
            const diagnostic: Diagnostic = { from: item.from, to: item.to, severity: item.severity, message: item.message }
            if (item.replacement) diagnostic.actions = [{
                name: `Replace with ${item.replacement}`,
                apply(editor, from, to) { editor.dispatch({ changes: { from, to, insert: item.replacement! }, selection: { anchor: from + item.replacement!.length } }); editor.focus() },
            }]
            if (item.insertWhereAt != null) diagnostic.actions = [{
                name: 'Add WHERE clause',
                apply(editor) { editor.dispatch({ changes: { from: item.insertWhereAt!, insert: ' WHERE ' }, selection: { anchor: item.insertWhereAt! + 7 } }); editor.focus() },
            }]
            return diagnostic
        }), { delay: 350 }),
    ]
}

function bookmarkExtension(lines: number[]) {
    const build = (state: EditorState) => Decoration.set(lines.filter(line => line > 0 && line <= state.doc.lines)
        .map(line => Decoration.line({ class: 'cm-bookmarked-line' }).range(state.doc.line(line).from)))
    return StateField.define<DecorationSet>({
        create: build,
        update(value, transaction) { return transaction.docChanged ? build(transaction.state) : value },
        provide: field => EditorView.decorations.from(field),
    })
}

export default function SqlEditor({ engine, schema, defaultSchema, value, onChange, onRun, onOpenTable, snippets = [], insertRequest, bookmarkLines = [], navigateRequest, formatRequest, onFormatError, onCursorLineChange }: Props) {
    const host = useRef<HTMLDivElement>(null)
    const view = useRef<EditorView | null>(null)
    const langCompartment = useRef(new Compartment())
    const bookmarkCompartment = useRef(new Compartment())
    // Keep latest callbacks without rebuilding the editor.
    const cbs = useRef({ onChange, onRun, onOpenTable, schema, defaultSchema, snippets, onCursorLineChange, onFormatError, engine })
    cbs.current = { onChange, onRun, onOpenTable, schema, defaultSchema, snippets, onCursorLineChange, onFormatError, engine }

    useEffect(() => {
        if (!host.current) return
        const runCurrent = (v: EditorView) => {
            const { from, to } = v.state.selection.main
            const stmt = from === to ? v.state.doc.toString() : v.state.sliceDoc(from, to)
            cbs.current.onRun(stmt)
            return true
        }
        const expandSnippet = (v: EditorView) => {
            const selection = v.state.selection.main
            if (selection.from !== selection.to) return false
            const before = v.state.sliceDoc(Math.max(0, selection.from - 40), selection.from)
            const match = /([A-Za-z_][\w]*)$/.exec(before)
            if (!match) return false
            const snippet = cbs.current.snippets.find(item => item.trigger === match[1].toLowerCase())
            if (!snippet) return false
            const rendered = renderSnippet(snippet.sql)
            const from = selection.from - match[1].length
            v.dispatch({ changes: { from, to: selection.to, insert: rendered.text }, selection: { anchor: from + rendered.cursor } })
            return true
        }
        const formatCurrent = (v: EditorView) => {
            try {
                const selection = v.state.selection.main
                const edit = formatSQLEdit(v.state.doc.toString(), selection.from, selection.to, cbs.current.engine)
                if (edit) v.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.selectionFrom, head: edit.selectionTo } })
            } catch (error) { cbs.current.onFormatError?.(String(error)) }
            return true
        }
        const ed = new EditorView({
            doc: value,
            parent: host.current,
            extensions: [
                basicSetup,
                lintGutter(),
                langCompartment.current.of(sqlExtension({ engine, schema, defaultSchema })),
                bookmarkCompartment.current.of(bookmarkExtension(bookmarkLines)),
                Prec.highest(keymap.of([{ key: 'Mod-Enter', run: runCurrent }, { key: 'Mod-Alt-l', run: formatCurrent }, { key: 'Tab', run: expandSnippet }, ...lintKeymap])),
                EditorView.updateListener.of(u => {
                    if (u.docChanged) cbs.current.onChange(u.state.doc.toString())
                    if (u.docChanged || u.selectionSet) cbs.current.onCursorLineChange?.(u.state.doc.lineAt(u.state.selection.main.head).number)
                }),
                EditorView.domEventHandlers({
                    mousedown(event, editor) {
                        if (!(event.metaKey || event.ctrlKey) || !cbs.current.onOpenTable) return false
                        const position = editor.posAtCoords({ x: event.clientX, y: event.clientY })
                        if (position == null) return false
                        const document = editor.state.doc.toString()
                        let from = position
                        let to = position
                        while (from > 0 && /[\w$.]/.test(document[from - 1])) from--
                        while (to < document.length && /[\w$.]/.test(document[to])) to++
                        const raw = document.slice(from, to)
                        const parts = raw.split('.')
                        const candidates = parts.length > 1 ? [raw, parts[0], parts[parts.length - 1]] : [raw]
                        const resolved = candidates.map(candidate => resolveTableReference(candidate, cbs.current.schema, cbs.current.defaultSchema)).find(Boolean)
                        if (!resolved) return false
                        event.preventDefault()
                        const separator = resolved.indexOf('.')
                        cbs.current.onOpenTable(resolved.slice(0, separator), resolved.slice(separator + 1))
                        return true
                    },
                }),
                EditorView.theme({
                    '&': { height: '100%', fontSize: '13px' },
                    '.cm-scroller': { fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' },
                }),
            ],
        })
        view.current = ed
        cbs.current.onCursorLineChange?.(ed.state.doc.lineAt(ed.state.selection.main.head).number)
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

    useEffect(() => {
        const editor = view.current
        if (!editor || !insertRequest) return
        const selection = editor.state.selection.main
        const rendered = renderSnippet(insertRequest.sql)
        editor.dispatch({ changes: { from: selection.from, to: selection.to, insert: rendered.text }, selection: { anchor: selection.from + rendered.cursor } })
        editor.focus()
    }, [insertRequest])

    useEffect(() => {
        const editor = view.current
        if (!editor || !navigateRequest) return
        const line = Math.max(1, Math.min(navigateRequest.line, editor.state.doc.lines))
        const position = editor.state.doc.line(line).from
        editor.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) })
        editor.focus()
    }, [navigateRequest])

    useEffect(() => {
        const editor = view.current
        if (!editor || !formatRequest) return
        try {
            const selection = editor.state.selection.main
            const edit = formatSQLEdit(editor.state.doc.toString(), selection.from, selection.to, engine)
            if (edit) editor.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.selectionFrom, head: edit.selectionTo } })
            editor.focus()
        } catch (error) { onFormatError?.(String(error)) }
    }, [engine, formatRequest, onFormatError])

    // Swap the SQL extension in place when the schema map (or engine) changes.
    useEffect(() => {
        view.current?.dispatch({
            effects: langCompartment.current.reconfigure(sqlExtension({ engine, schema, defaultSchema })),
        })
    }, [engine, schema, defaultSchema])

    useEffect(() => {
        view.current?.dispatch({ effects: bookmarkCompartment.current.reconfigure(bookmarkExtension(bookmarkLines)) })
    }, [bookmarkLines])

    return <div className="sql-editor" ref={host} />
}
