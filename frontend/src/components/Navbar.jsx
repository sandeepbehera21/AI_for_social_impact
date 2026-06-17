import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Menu, X, Brain, LogOut, LayoutDashboard, LifeBuoy } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { dashboardPathFor } from '../lib/roles.js'
import ThemeToggle from './ThemeToggle.jsx'
import NotificationBell from './NotificationBell.jsx'


const baseLinks = [
  { to: '/', label: 'Home', end: true },
  { to: '/meditation', label: 'Meditation' },
  { to: '/chat', label: 'Chat' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()

  const linkClass = ({ isActive }) =>
    `relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      isActive
        ? 'text-primary bg-primary-soft'
        : 'text-muted hover:text-fg hover:bg-surface-2'
    }`

  // Authed users get a Dashboard link; everyone else gets Portal.
  const links = user
    ? (role === 'doctor'
        ? [
            { to: '/', label: 'Home', end: true },
            { to: dashboardPathFor(role), label: 'Dashboard', icon: LayoutDashboard },
            { to: '/doctor/patients', label: 'Patients' },
            { to: '/doctor/appointments', label: 'Appointments' },
            { to: '/doctor/analytics', label: 'Analytics' },
          ]
        : (role === 'patient'
            ? [
                { to: '/', label: 'Home', end: true },
                { to: '/chat', label: 'Chat' },
                { to: '/consult-doc', label: 'Consult Doc' },
                { to: '/habits', label: 'Habits' },
                { to: '/journal', label: 'Journal' },
                { to: '/cbt', label: 'CBT' },
                { to: dashboardPathFor(role), label: 'Dashboard', icon: LayoutDashboard },
              ]
            : (role === 'admin'
                ? [
                    { to: '/', label: 'Home', end: true },
                    { to: dashboardPathFor(role), label: 'Dashboard', icon: LayoutDashboard },
                  ]
                : [
                    ...baseLinks,
                    { to: dashboardPathFor(role), label: 'Dashboard', icon: LayoutDashboard },
                  ])))
    : [...baseLinks]

  const isPatient = user && role === 'patient'

  const handleLogout = async () => {
    setOpen(false)
    await logout()
    navigate('/', { replace: true })
  }

  return (
    <header className="sticky top-0 z-50 glass border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Brain className="h-5 w-5" />
          </span>
          <span className="brand-text text-xl font-extrabold tracking-tight">
            MindEase
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
          {isPatient && (
            <NavLink
              to="/sos"
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 py-1.5 text-sm font-semibold text-danger transition hover:border-danger/70"
            >
              <LifeBuoy className="h-4 w-4" /> SOS
            </NavLink>
          )}
          <span className="mx-1.5 h-5 w-px bg-border" aria-hidden="true" />
          {user && (
            <>
              <NotificationBell />
              <span className="mx-1.5 h-5 w-px bg-border" aria-hidden="true" />
            </>
          )}
          <ThemeToggle />

          {user ? (
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-primary hover:text-primary"
            >
              <LogOut className="h-4 w-4" /> Logout
            </button>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-fg shadow-sm transition hover:bg-primary-hover"
            >
              Sign In
            </Link>
          )}
        </nav>

        {/* Mobile controls */}
        <div className="flex items-center gap-2 md:hidden">
          {user && <NotificationBell />}
          <ThemeToggle />

          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-fg"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {open && (
        <nav className="flex flex-col gap-1 border-t border-border bg-surface/95 px-4 py-3 md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={linkClass}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </NavLink>
          ))}
          {isPatient && (
            <NavLink
              to="/sos"
              className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg bg-danger-soft px-3 py-1.5 text-sm font-semibold text-danger"
              onClick={() => setOpen(false)}
            >
              <LifeBuoy className="h-4 w-4" /> SOS Center
            </NavLink>
          )}
          {user ? (
            <button
              onClick={handleLogout}
              className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-primary"
            >
              <LogOut className="h-4 w-4" /> Logout
            </button>
          ) : (
            <Link
              to="/login"
              className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-fg"
              onClick={() => setOpen(false)}
            >
              Sign In
            </Link>
          )}
        </nav>
      )}
    </header>
  )
}
