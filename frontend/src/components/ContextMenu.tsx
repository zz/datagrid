import { useEffect, useRef } from 'react'

export interface MenuItem {
    label: string
    onClick: () => void
    disabled?: boolean
    danger?: boolean
    separator?: boolean
}

// ContextMenu renders a right-click menu at (x, y) and closes on outside
// click, Escape, or after an item is chosen.
export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose()
        }
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
        window.addEventListener('mousedown', onDown, true)
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('mousedown', onDown, true)
            window.removeEventListener('keydown', onKey)
        }
    }, [onClose])

    // Keep the menu on-screen.
    const style: React.CSSProperties = {
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - items.length * 28 - 10),
    }

    return (
        <div className="context-menu" style={style} ref={ref}>
            {items.map((it, i) =>
                it.separator ? (
                    <div key={i} className="context-sep" />
                ) : (
                    <div
                        key={i}
                        className={`context-item ${it.disabled ? 'disabled' : ''} ${it.danger ? 'danger' : ''}`}
                        onClick={() => {
                            if (it.disabled) return
                            it.onClick()
                            onClose()
                        }}
                    >
                        {it.label}
                    </div>
                ),
            )}
        </div>
    )
}
