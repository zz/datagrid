import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
    label: string
    onClick: () => void
    disabled?: boolean
    danger?: boolean
    separator?: boolean
}

export function gridContextMenuCoordinates(event: { bounds: { x: number; y: number }; localEventX: number; localEventY: number }) {
    return { x: event.bounds.x + event.localEventX, y: event.bounds.y + event.localEventY }
}

export function constrainContextMenuPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number, margin = 8) {
    return {
        left: Math.max(margin, Math.min(x, viewportWidth - width - margin)),
        top: Math.max(margin, Math.min(y, viewportHeight - height - margin)),
    }
}

// ContextMenu renders a right-click menu at (x, y) and closes on outside
// click, Escape, or after an item is chosen.
export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState({ left: x, top: y })

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

    useLayoutEffect(() => {
        const menu = ref.current
        if (!menu) return
        const bounds = menu.getBoundingClientRect()
        setPosition(constrainContextMenuPosition(x, y, bounds.width, bounds.height, window.innerWidth, window.innerHeight))
    }, [items, x, y])

    return (
        <div className="context-menu" style={position} ref={ref}>
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
