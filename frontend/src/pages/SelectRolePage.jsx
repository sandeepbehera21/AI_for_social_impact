import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Stethoscope, User, Loader2, Edit3 } from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { ROLES, dashboardPathFor } from '../lib/roles.js'

export default function SelectRolePage() {
  const { user, assignGoogleRole } = useAuth()
  const navigate = useNavigate()
  
  const [selectedRole, setSelectedRole] = useState('')
  const [name, setName] = useState(user?.displayName || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!selectedRole) {
      setError('Please choose a portal to enter (Patient or Doctor).')
      return
    }
    setError('')
    setBusy(true)
    try {
      await assignGoogleRole(user, selectedRole, name)
      navigate(dashboardPathFor(selectedRole), { replace: true })
    } catch (err) {
      setError(err.message || 'Failed to complete profile configuration.')
      setBusy(false)
    }
  }

  return (
    <PageTransition className="mx-auto flex max-w-2xl flex-col px-5 py-16 text-center">
      <h1 className="mb-2 text-3xl font-bold text-fg">Complete your profile</h1>
      <p className="mb-8 text-muted">
        Choose how you would like to enter the MindEase portal.
      </p>

      {error && (
        <div className="mx-auto mb-6 w-full max-w-md rounded-lg border border-danger/40 bg-danger-soft px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="mx-auto w-full max-w-md space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Patient Card */}
          <div
            onClick={() => setSelectedRole(ROLES.PATIENT)}
            className={`cursor-pointer rounded-xl border-2 p-6 text-left transition ${
              selectedRole === ROLES.PATIENT
                ? 'border-primary bg-primary-soft shadow-sm'
                : 'border-border bg-surface hover:border-border-strong'
            }`}
          >
            <User className={`mb-3 h-8 w-8 ${selectedRole === ROLES.PATIENT ? 'text-primary' : 'text-faint'}`} />
            <h3 className="font-semibold text-fg">Patient</h3>
            <p className="text-xs text-muted">Find doctors &amp; book sessions</p>
          </div>

          {/* Doctor Card */}
          <div
            onClick={() => setSelectedRole(ROLES.DOCTOR)}
            className={`cursor-pointer rounded-xl border-2 p-6 text-left transition ${
              selectedRole === ROLES.DOCTOR
                ? 'border-primary bg-primary-soft shadow-sm'
                : 'border-border bg-surface hover:border-border-strong'
            }`}
          >
            <Stethoscope className={`mb-3 h-8 w-8 ${selectedRole === ROLES.DOCTOR ? 'text-primary' : 'text-faint'}`} />
            <h3 className="font-semibold text-fg">Doctor</h3>
            <p className="text-xs text-muted">Consult &amp; approve appointments</p>
          </div>
        </div>

        {/* Name Input */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Edit3 className="h-4 w-4 shrink-0 text-faint" />
          <input
            type="text"
            required
            placeholder="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-transparent py-3 text-sm text-fg outline-none placeholder:text-faint"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Setting up account…' : 'Complete Registration'}
        </button>
      </form>
    </PageTransition>
  )
}
