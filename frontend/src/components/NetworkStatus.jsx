import { useState, useEffect } from 'react'
import { Wifi, WifiOff, X } from 'lucide-react'

/**
 * NetworkStatus component
 * Monitors browser online/offline status and displays a premium, non-intrusive
 * notification alert in the bottom-right corner when connection state changes.
 */
export default function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showBanner, setShowBanner] = useState(!navigator.onLine)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setShowBanner(true)
      // Auto-dismiss reconnection confirmation banner after 4 seconds
      const timer = setTimeout(() => {
        setShowBanner(false)
      }, 4000)
      return () => clearTimeout(timer)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setShowBanner(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (!showBanner) return null

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3.5 rounded-2xl border p-4 shadow-float backdrop-blur-md transition-all duration-300 animate-slide-in ${
        isOnline
          ? 'border-success-soft bg-success-soft/90 text-success'
          : 'border-warning-soft bg-warning-soft/90 text-warning'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface shadow-sm">
        {isOnline ? (
          <Wifi className="h-5 w-5 text-success animate-pulse" />
        ) : (
          <WifiOff className="h-5 w-5 text-warning animate-bounce" />
        )}
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-semibold text-fg">
          {isOnline ? 'Connection Restored' : 'Working Offline'}
        </h4>
        <p className="mt-1 text-xs text-muted leading-relaxed">
          {isOnline
            ? "We've reconnected successfully. All features are now fully functional and syncing."
            : 'MindEase is running offline. You can continue reading and meditating, and your actions will sync upon reconnection.'}
        </p>
      </div>
      <button
        onClick={() => setShowBanner(false)}
        className="ml-2 shrink-0 rounded-lg p-1 text-muted transition hover:bg-surface-2 hover:text-fg"
        aria-label="Dismiss network alert"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
