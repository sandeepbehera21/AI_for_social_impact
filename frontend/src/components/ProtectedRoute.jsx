/**
 * ProtectedRoute — gates a route on authentication and (optionally) role.
 *
 *   <ProtectedRoute>...</ProtectedRoute>                 → any signed-in user
 *   <ProtectedRoute allow="doctor">...</ProtectedRoute>  → doctors only
 *
 * Behaviour:
 *   - while auth state is resolving → spinner (avoids a flash of redirect)
 *   - not signed in                 → /login (remembers where you were headed)
 *   - signed in, wrong role         → bounced to that user's own dashboard
 */
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { dashboardPathFor, ROLES } from '../lib/roles.js'

export default function ProtectedRoute({ allow, children }) {
  const { user, profile, role, loading, logout } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-primary">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // If authenticated but role is not yet assigned (e.g. new Google sign-up),
  // force redirect to the select-role wizard.
  if (!role && location.pathname !== '/select-role') {
    return <Navigate to="/select-role" replace />
  }

  // Onboarding gate for patients: redirect to /onboarding if not completed
  if (role === ROLES.PATIENT && profile?.onboarded !== true && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  // Role-gated route: bounce wrong-role users to their own dashboard, and any
  // signed-in user without a resolved role back to the portal landing.
  if (allow && role !== allow) {
    return <Navigate to={role ? dashboardPathFor(role) : '/'} replace />
  }

  // Unverified doctor gate
  if (role === ROLES.DOCTOR && profile?.verified !== true) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-5 py-20 text-center animate-fade-in">
        <div className="card p-8 shadow-lg flex flex-col items-center gap-5 border border-primary/20 bg-surface-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary animate-pulse">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-extrabold text-fg">Clinician Verification Pending</h1>
          <p className="text-sm text-muted leading-relaxed max-w-sm">
            Thank you for joining MindEase, Dr. {profile?.name || 'Clinician'}. To ensure patient safety and comply with healthcare standards, our administration team is currently verifying your medical credentials and license.
          </p>
          <div className="w-full h-px bg-border my-1" />
          <p className="text-xs text-faint">
            This process typically takes 24–48 hours. You will receive an email notification once your clinician profile is verified and active.
          </p>
          <button
            onClick={logout}
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted transition hover:border-primary hover:text-primary"
          >
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  return children
}
