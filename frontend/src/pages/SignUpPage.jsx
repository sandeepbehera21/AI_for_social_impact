import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, Stethoscope, User, Mail, Lock, UserRound } from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { ROLES, dashboardPathFor } from '../lib/roles.js'
import { authErrorMessage } from '../lib/authErrors.js'

const ROLE_CARDS = [
  {
    value: ROLES.PATIENT,
    label: 'Patient',
    icon: User,
    blurb: 'Find doctors and book sessions',
  },
  {
    value: ROLES.DOCTOR,
    label: 'Doctor',
    icon: Stethoscope,
    blurb: 'Review and accept patient requests',
  },
]

export default function SignUpPage() {
  const { signUp, signInWithGoogle, user, role, loading, googleError } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [selectedRole, setSelectedRole] = useState(ROLES.PATIENT)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // After Google redirect returns, user + role are set by AuthContext.
  // New Google users have no role yet → go to /select-role.
  // Returning Google users already have a role → go to their dashboard.
  useEffect(() => {
    if (!loading && user) {
      navigate(role ? dashboardPathFor(role) : '/select-role', { replace: true })
    }
  }, [user, role, loading])

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must contain at least one letter and one number.')
      return
    }

    setBusy(true)
    try {
      await signUp({ name: name.trim().slice(0, 100), email, password, role: selectedRole })
      navigate(dashboardPathFor(selectedRole), { replace: true })
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  const onGoogleSignIn = async () => {
    setError('')
    setBusy(true)
    try {
      // signInWithGoogle opens a popup for Google auth.
      // Navigation after auth is handled by the useEffect above.
      await signInWithGoogle()
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <PageTransition className="mx-auto flex max-w-md flex-col px-5 py-16">
      <div className="card p-8 shadow-md">
        <h1 className="mb-1 text-center text-2xl font-bold text-fg">
          Create your account
        </h1>
        <p className="mb-6 text-center text-sm text-muted">
          Join MindEase to connect patients with doctors.
        </p>

        {(error || googleError) && (
          <div className="mb-4 rounded-lg border border-danger/40 bg-danger-soft px-4 py-2.5 text-sm text-danger">
            {error || authErrorMessage(googleError)}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Role selector */}
          <div>
            <label className="mb-2 block text-sm font-medium text-fg">
              I am a…
            </label>
            <div className="grid grid-cols-2 gap-3">
              {ROLE_CARDS.map((r) => {
                const active = selectedRole === r.value
                return (
                  <button
                    type="button"
                    key={r.value}
                    onClick={() => setSelectedRole(r.value)}
                    className={`flex flex-col items-center gap-1 rounded-xl border-2 p-3 text-center transition ${
                      active
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-border text-muted hover:border-border-strong'
                    }`}
                  >
                    <r.icon className="h-6 w-6" />
                    <span className="text-sm font-semibold">{r.label}</span>
                    <span className="text-[11px] leading-tight text-faint">
                      {r.blurb}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <Field
            icon={UserRound}
            type="text"
            placeholder="Full name"
            value={name}
            onChange={setName}
            autoComplete="name"
            maxLength={100}
            required
          />
          <Field
            icon={Mail}
            type="email"
            placeholder="Email address"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />
          <Field
            icon={Lock}
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={6}
            required
          />

          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Creating account…' : 'Sign Up'}
          </button>

          <div className="my-4 flex items-center justify-between gap-3 text-xs text-faint">
            <span className="h-px w-full bg-border"></span>
            <span>OR</span>
            <span className="h-px w-full bg-border"></span>
          </div>

          <button
            type="button"
            onClick={onGoogleSignIn}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-5 py-3 font-semibold text-fg transition hover:bg-surface-2 disabled:opacity-60"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </PageTransition>
  )
}

function Field({ icon: Icon, value, onChange, ...rest }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      <Icon className="h-4 w-4 shrink-0 text-faint" />
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent py-3 text-sm text-fg outline-none placeholder:text-faint"
      />
    </div>
  )
}
