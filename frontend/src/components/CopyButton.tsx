import { useState } from 'react'
import { Copy } from '../../wailsjs/go/api/App'

// CopyButton copies text to the OS clipboard via the backend (reliable in
// the webview, where navigator.clipboard can be blocked). Shows a brief
// "Copied" confirmation.
export default function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
    const [done, setDone] = useState(false)
    const copy = async () => {
        try {
            await Copy(text)
            setDone(true)
            setTimeout(() => setDone(false), 1200)
        } catch {
            // Fall back to the browser clipboard if the backend call fails.
            try {
                await navigator.clipboard.writeText(text)
                setDone(true)
                setTimeout(() => setDone(false), 1200)
            } catch {
                /* ignore */
            }
        }
    }
    return (
        <button className={`copy-btn ${className ?? ''}`} onClick={copy} title="Copy to clipboard">
            {done ? '✓ Copied' : label}
        </button>
    )
}
