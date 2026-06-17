/**
 * DoctorLayout — the clinical "shell" shared by every Doctor-portal page.
 *
 * Provides the production telehealth chrome: a page header with the doctor's
 * identity, a persistent clinical sub-navigation (Dashboard · Patients ·
 * Appointments · Analytics), and a consistent max-width / padding rhythm.
 * This is what makes the Doctor portal read as a clinician dashboard rather
 * than the patient app.
 */
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, CalendarDays, BarChart3, Stethoscope } from 'lucide-react'
import PageTransition from './PageTransition.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

const NAV = [
  { to: '/dashboard/doctor', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/doctor/patients', label: 'Patients', icon: Users },
  { to: '/doctor/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/doctor/analytics', label: 'Analytics', icon: BarChart3 },
]

export default function DoctorLayout({ title, subtitle, actions, children }) {
  const { profile } = useAuth()

  return (
    <PageTransition className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
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
