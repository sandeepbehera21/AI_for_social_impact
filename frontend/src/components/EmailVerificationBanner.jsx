import { useState } from 'react'
import { AlertTriangle, Loader2, Check, RefreshCw } from 'lucide-react'
import { sendEmailVerification } from 'firebase/auth'
import { auth } from '../lib/firebase.js'

export default function EmailVerificationBanner({ user }) {
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null) // { type: 'ok'|'err', text }
  const [isBypassed, setIsBypassed] = useState(
    localStorage.getItem(`mindease_email_verified_bypass_${user?.uid}`) === 'true'
  )

  if (isBypassed || !user || user.emailVerified) return null

  const handleResend = async () => {
    setLoading(true)
    setNotice(null)
    try {
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser)
        setNotice({
          type: 'ok',
          text: 'Verification email sent! Please check your inbox and spam folder.'
        })
      } else {
        throw new Error('No active authentication session found.')
      }
    } catch (err) {
      console.error('[EmailVerificationBanner] Error sending verification:', err)
      setNotice({
        type: 'err',
        text: err.message || 'Failed to send verification email.'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleBypass = () => {
    localStorage.setItem(`mindease_email_verified_bypass_${user.uid}`, 'true')
    setIsBypassed(true)
    // Dispatch a storage event to let other mounted instances know
    window.dispatchEvent(new Event('storage'))
  }

  return (
    <div className="mb-5 rounded-xl border border-warning/30 bg-warning-soft/10 p-4 text-sm text-warning backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-fg">Verify your email address</div>
          <div className="text-xs text-muted mt-0.5">
            Please check <span className="font-semibold text-fg">{user.email}</span> for a verification link.
          </div>

          {/* Action buttons */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={handleResend}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-warning/10 border border-warning/20 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/20 disabled:opacity-40 transition cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3" />
                  Resend Verification Link
                </>
              )}
            </button>

            <button
              onClick={handleBypass}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success/15 border border-success/30 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success hover:text-white transition cursor-pointer"
              title="Simulate email verification for local testing"
            >
              <Check className="h-3 w-3" />
              Verify Email (Testing Bypass)
            </button>
          </div>
        </div>
      </div>

      {/* Success/Error notice */}
      {notice && (
        <div
          className={`mt-3 rounded-lg border p-2.5 text-xs ${
            notice.type === 'err'
              ? 'border-danger/30 bg-danger-soft text-danger'
              : 'border-success/30 bg-success-soft text-success'
          }`}
        >
          {notice.text}
        </div>
      )}
    </div>
  )
}
