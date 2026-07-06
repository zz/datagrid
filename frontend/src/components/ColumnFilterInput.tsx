import { useRef, useState } from 'react'

// ColumnFilterInput is a text input with column-name autocomplete for the
// data-view WHERE filter. As you type an identifier it suggests matching
// column names; the rest of the expression (operators, literals) is free text.
export default function ColumnFilterInput({
    value,
    onChange,
    onSubmit,
    columns,
    placeholder,
    className,
}: {
    value: string
    onChange: (v: string) => void
    onSubmit: () => void
    columns: string[]
    placeholder?: string
    className?: string
}) {
    const ref = useRef<HTMLInputElement>(null)
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(0)
    // The identifier token under the cursor, and where it starts.
    const [token, setToken] = useState<{ word: string; start: number; end: number }>({ word: '', start: 0, end: 0 })

    // Suggestions for the current token (prefix match, excluding an exact hit).
    const matches =
        token.word.length >= 1
            ? columns.filter(c => {
                  const lc = c.toLowerCase()
                  const w = token.word.toLowerCase()
                  return lc.startsWith(w) && lc !== w
              })
            : []

    const recompute = (text: string, pos: number) => {
        const before = text.slice(0, pos)
        const m = before.match(/[A-Za-z_][A-Za-z0-9_]*$/)
        if (m) setToken({ word: m[0], start: pos - m[0].length, end: pos })
        else setToken({ word: '', start: pos, end: pos })
    }

    const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value)
        recompute(e.target.value, e.target.selectionStart ?? e.target.value.length)
        setOpen(true)
        setActive(0)
    }

    const accept = (col: string) => {
        const next = value.slice(0, token.start) + col + value.slice(token.end)
        onChange(next)
        setOpen(false)
        // Restore focus and place the cursor after the inserted column name.
        const caret = token.start + col.length
        requestAnimationFrame(() => {
            const el = ref.current
            if (el) {
                el.focus()
                el.setSelectionRange(caret, caret)
            }
        })
    }

    const showList = open && matches.length > 0
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (showList) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive(a => (a + 1) % matches.length)
                return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive(a => (a - 1 + matches.length) % matches.length)
                return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                accept(matches[active])
                return
            }
            if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
                return
            }
        }
        if (e.key === 'Enter') onSubmit()
    }

    return (
        <div className="ac-input-wrap">
            <input
                ref={ref}
                className={className}
                placeholder={placeholder}
                value={value}
                spellCheck={false}
                onChange={onInput}
                onKeyDown={onKeyDown}
                onKeyUp={e => recompute(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
                onClick={e => recompute(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
                onBlur={() => setTimeout(() => setOpen(false), 120)}
            />
            {showList && (
                <div className="ac-list">
                    {matches.slice(0, 12).map((c, i) => (
                        <div
                            key={c}
                            className={`ac-item ${i === active ? 'active' : ''}`}
                            onMouseDown={e => {
                                e.preventDefault()
                                accept(c)
                            }}
                            onMouseEnter={() => setActive(i)}
                        >
                            {c}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
