import { useEffect, useRef } from 'react'

interface ResizeHandleProps {
    axis: 'horizontal' | 'vertical'
    onResize: (delta: number) => void
    title: string
}

export default function ResizeHandle({ axis, onResize, title }: ResizeHandleProps) {
    const drag = useRef<{ x: number; y: number } | null>(null)

    useEffect(() => {
        const move = (event: PointerEvent) => {
            if (!drag.current) return
            const delta = axis === 'horizontal' ? event.clientX - drag.current.x : event.clientY - drag.current.y
            drag.current = { x: event.clientX, y: event.clientY }
            onResize(delta)
        }
        const stop = () => {
            drag.current = null
            document.body.classList.remove('resizing-horizontal', 'resizing-vertical')
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
        return () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', stop)
        }
    }, [axis, onResize])

    return (
        <div
            className={`resize-handle ${axis}`}
            role="separator"
            aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
            title={title}
            onPointerDown={event => {
                event.preventDefault()
                drag.current = { x: event.clientX, y: event.clientY }
                document.body.classList.add(axis === 'horizontal' ? 'resizing-horizontal' : 'resizing-vertical')
            }}
        />
    )
}
