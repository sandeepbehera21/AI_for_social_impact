import React from 'react'
import { ShieldAlert, RefreshCw } from 'lucide-react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  static sanitizeTelemetry(val) {
    if (!val) return val
    let str = typeof val === 'string' ? val : (val.stack || val.message || String(val))
    
    // Redact emails
    str = str.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, '[EMAIL_REDACTED]')
    
    // Redact JWT/Bearer tokens
    str = str.replace(/ey[a-zA-Z0-9-_=]+\.ey[a-zA-Z0-9-_=]+\.?[a-zA-Z0-9-_=]*/gi, '[JWT_REDACTED]')
    
    // Redact RSA/PEM Cryptographic Keys
    str = str.replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/gi, '[KEY_REDACTED]')
    
    // Redact potential Firebase API keys
    str = str.replace(/AIzaSy[a-zA-Z0-9-_]{33}/g, '[API_KEY_REDACTED]')
    
    return str
  }

  componentDidCatch(error, errorInfo) {
    const safeError = ErrorBoundary.sanitizeTelemetry(error)
    const safeStack = ErrorBoundary.sanitizeTelemetry(errorInfo?.componentStack)
    console.error('[ErrorBoundary] Caught sanitized component error:', safeError, '\nStack:', safeStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onReset) {
      this.props.onReset()
    } else {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface-2 p-6 text-center shadow-xl backdrop-blur-md">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger animate-pulse">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-fg">
            Something went wrong here
          </h3>
          <p className="mb-4 max-w-sm text-sm text-muted">
            {this.state.error?.message || 
              "We encountered an issue loading this feature. This could be due to a camera permissions error or a temporary processing glitch."}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={this.handleReset}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-fg transition hover:bg-primary-hover"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
            <button
              onClick={() => { window.location.href = '/' }}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-muted transition hover:bg-surface-2 hover:text-fg"
            >
              Return Home
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
