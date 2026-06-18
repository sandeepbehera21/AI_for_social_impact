/**
 * DoctorLayout — the clinical "shell" shared by every Doctor-portal page.
 *
 * Provides the production telehealth chrome: a page header with the doctor's
 * identity, a persistent clinical sub-navigation (Dashboard · Patients ·
 * Appointments · Analytics), and a consistent max-width / padding rhythm.
 * This is what makes the Doctor portal read as a clinician dashboard rather
 * than the patient app.
 */
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, CalendarDays, BarChart3, Stethoscope, Loader2, Edit3, ShieldAlert } from 'lucide-react'
import PageTransition from './PageTransition.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { db } from '../lib/firebase.js'
import { doc, updateDoc } from 'firebase/firestore'

const NAV = [
  { to: '/dashboard/doctor', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/doctor/patients', label: 'Patients', icon: Users },
  { to: '/doctor/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/doctor/analytics', label: 'Analytics', icon: BarChart3 },
]

export default function DoctorLayout({ title, subtitle, actions, children }) {
  const { profile } = useAuth()

  const isProfileIncomplete = profile && profile.role === 'doctor' && (
    !profile.specialization ||
    !profile.licenseNumber ||
    profile.experience === undefined ||
    profile.experience === null ||
    profile.experience === '' ||
    !profile.clinicAffiliation ||
    !profile.bio
  )

  return (
    <PageTransition className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
      {/* Complete Profile Popup Modal for Legacy Doctors */}
      {isProfileIncomplete && (
        <DoctorProfileSetupModal uid={profile.uid} />
      )}

      {/* Header */}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary-soft">
            <Stethoscope className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>

      {/* Clinical sub-navigation */}
      <nav className="mb-8 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1.5 shadow-sm">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                isActive
                  ? 'bg-primary text-primary-fg shadow-sm'
                  : 'text-muted hover:bg-surface-2 hover:text-fg'
              }`
            }
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <ErrorBoundary>
        {children}
      </ErrorBoundary>

      <p className="mt-12 text-center text-[11px] text-faint">
        Signed in as Dr. {profile?.name || profile?.email || 'Clinician'} · Clinical data is
        access-controlled and end-to-end signed.
      </p>
    </PageTransition>
  )
}

function DoctorProfileSetupModal({ uid }) {
  const [specialization, setSpecialization] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [experience, setExperience] = useState('')
  const [clinicAffiliation, setClinicAffiliation] = useState('')
  const [bio, setBio] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!specialization) {
      setError('Please select your specialization.')
      return
    }
    const expNum = parseInt(experience, 10)
    if (isNaN(expNum) || expNum < 0 || expNum > 60) {
      setError('Please enter a valid years of experience (0-60).')
      return
    }
    setError('')
    setBusy(true)
    try {
      const userRef = doc(db, 'users', uid)
      await updateDoc(userRef, {
        specialization,
        licenseNumber: licenseNumber.trim(),
        experience: expNum,
        clinicAffiliation: clinicAffiliation.trim(),
        bio: bio.trim(),
      })
    } catch (err) {
      console.error('[doctor-setup] Failed to update profile:', err)
      setError(err.message || 'Failed to update credentials. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-2xl border border-primary/20 bg-surface p-6 shadow-xl animate-scale-in max-h-[90vh] overflow-y-auto">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary mb-3">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-fg">Complete Your Clinician Profile</h2>
          <p className="text-xs text-muted mt-1 leading-relaxed max-w-sm">
            To comply with healthcare standards, please complete your professional details. This information will be reviewed by administrators and displayed to patients.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/40 bg-danger-soft px-4 py-2.5 text-xs text-danger">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4 text-left">
          {/* Specialization */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5 uppercase tracking-wider">Specialization</label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <select
                required
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                className="w-full bg-transparent py-3 text-sm text-fg outline-none border-none cursor-pointer"
              >
                <option value="" disabled>Select Specialization</option>
                <option value="Psychiatrist">Psychiatrist (MD)</option>
                <option value="Clinical Psychologist">Clinical Psychologist</option>
                <option value="Licensed Counselor">Licensed Counselor</option>
                <option value="Therapist">Therapist</option>
              </select>
            </div>
          </div>

          {/* License Number */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5 uppercase tracking-wider">Medical License / Registration Number</label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <Edit3 className="h-4 w-4 shrink-0 text-faint" />
              <input
                type="text"
                required
                placeholder="e.g. MCI-12345, State Board ID"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                className="w-full bg-transparent py-3 text-sm text-fg outline-none placeholder:text-faint"
              />
            </div>
          </div>

          {/* Experience & Affiliation */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-fg mb-1.5 uppercase tracking-wider">Years of Experience</label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                <input
                  type="number"
                  required
                  min="0"
                  max="60"
                  placeholder="e.g. 5"
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  className="w-full bg-transparent py-3 text-sm text-fg outline-none placeholder:text-faint"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg mb-1.5 uppercase tracking-wider">Clinic Affiliation</label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                <input
                  type="text"
                  required
                  placeholder="e.g. Apollo Hospital"
                  value={clinicAffiliation}
                  onChange={(e) => setClinicAffiliation(e.target.value)}
                  className="w-full bg-transparent py-3 text-sm text-fg outline-none placeholder:text-faint"
                />
              </div>
            </div>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5 uppercase tracking-wider">Professional Bio</label>
            <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <textarea
                placeholder="Tell patients about your expertise, qualifications, and caring approach..."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows="3"
                className="w-full bg-transparent text-sm text-fg outline-none resize-none placeholder:text-faint"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-60 cursor-pointer"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Saving profile details…' : 'Save & Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
