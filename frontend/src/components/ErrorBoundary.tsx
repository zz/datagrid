import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
    children: ReactNode
    // When resetKey changes, a caught error is cleared and children re-render.
    // Use the tab id so switching tabs / reopening recovers automatically.
    resetKey?: string
    // compact renders the fallback inline (for a single panel) rather than
    // as a full-screen message.
    compact?: boolean
    // label names the failed area in the message, e.g. "this tab".
    label?: string
}

interface State {
    error: Error | null
}

// ErrorBoundary keeps a render-time exception contained. Scope it around an
// individual panel (a tab, the sidebar) so a failure there never blanks the
// rest of the window — the connection tree and other tabs stay usable.
export default class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidUpdate(prev: Props) {
        // A new resetKey means we've navigated elsewhere; drop the stale error.
        if (this.state.error && prev.resetKey !== this.props.resetKey) {
            this.setState({ error: null })
        }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('Contained render error:', error, info.componentStack)
    }

    render() {
        if (!this.state.error) return this.props.children

        const where = this.props.label ?? 'This view'
        return (
            <div className={this.props.compact ? 'error-boundary compact' : 'error-boundary'}>
                <h2>{where} hit an error</h2>
                <p>The rest of the app is unaffected — your connections and other tabs still work.</p>
                <pre>{this.state.error.message}</pre>
                <button onClick={() => this.setState({ error: null })}>Try again</button>
            </div>
        )
    }
}
