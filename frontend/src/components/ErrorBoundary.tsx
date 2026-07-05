import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
    children: ReactNode
}

interface State {
    error: Error | null
}

// ErrorBoundary keeps a render-time exception in one subtree from blanking
// the whole window. Without it, any thrown error unmounts the app and leaves
// a white screen.
export default class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('Unhandled render error:', error, info.componentStack)
    }

    render() {
        if (this.state.error) {
            return (
                <div className="error-boundary">
                    <h2>Something went wrong</h2>
                    <p>The interface hit an unexpected error. Your connections are unaffected.</p>
                    <pre>{this.state.error.message}</pre>
                    <button onClick={() => this.setState({ error: null })}>Try again</button>
                </div>
            )
        }
        return this.props.children
    }
}
