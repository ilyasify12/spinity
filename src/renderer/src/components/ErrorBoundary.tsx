import { Component, type ReactNode } from 'react'

interface Props {
  name: string
  resetKey?: unknown
  children: ReactNode
}

interface State {
  error: Error | null
}

/** One crashing page must never blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error(`[ui] ${this.props.name} crashed`, error)
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="card">
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Something broke here</h2>
          <p className="hint">{this.props.name} hit an error: {this.state.error.message}</p>
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
