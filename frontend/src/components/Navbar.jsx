import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { Menu, X, Brain, LogOut, LayoutDashboard, LifeBuoy, User, Shield, Calendar, Mail, FileText, ChevronDown } from 'lucide-react'
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
  const { user, role, logout, profile } = useAuth()
  const navigate = useNavigate()

  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const profileMenuRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const initials = (profile?.name || user?.displayName || user?.email || 'U')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

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
          {user && (
            <>
              <span className="mx-1.5 h-5 w-px bg-border" aria-hidden="true" />
              {/* Profile Dropdown */}
              <div className="relative" ref={profileMenuRef}>
                <button
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  className="flex items-center gap-1.5 rounded-lg border border-border p-1.5 hover:bg-surface-2 transition cursor-pointer"
                  aria-label="User menu"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-fg text-xs font-bold shadow-sm">
                    {initials}
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-muted" />
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 mt-2 z-50 w-56 rounded-xl border border-border bg-surface shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="px-4 py-3 bg-surface-2 border-b border-border">
                      <div className="text-xs font-bold text-fg truncate">{profile?.name || user?.displayName || 'User'}</div>
                      <div className="text-[10px] text-muted truncate mt-0.5">{user?.email}</div>
                      <span className={`inline-flex mt-2 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        role === 'doctor' ? 'bg-emerald-soft text-emerald-400' : role === 'admin' ? 'bg-red-soft text-danger' : 'bg-primary-soft text-primary'
                      }`}>
                        {role || 'User'}
                      </span>
                    </div>
                    
                    <div className="p-1 divide-y divide-border/40">
                      <div className="py-1">
                        <button
                          onClick={() => {
                            setProfileMenuOpen(false)
                            navigate(dashboardPathFor(role))
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted hover:text-fg hover:bg-surface-2 rounded-lg transition cursor-pointer"
                        >
                          <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
                        </button>
                        <button
                          onClick={() => {
                            setProfileMenuOpen(false)
                            setProfileModalOpen(true)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted hover:text-fg hover:bg-surface-2 rounded-lg transition cursor-pointer"
                        >
                          <User className="h-3.5 w-3.5" /> Profile Details
                        </button>
                      </div>
                      <div className="pt-1">
                        <button
                          onClick={handleLogout}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-danger hover:bg-danger-soft/10 rounded-lg transition cursor-pointer"
                        >
                          <LogOut className="h-3.5 w-3.5" /> Logout
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {!user && (
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
          {user && (
            <button
              onClick={() => {
                setOpen(false)
                setProfileModalOpen(true)
              }}
              className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-primary cursor-pointer"
            >
              <User className="h-4 w-4" /> Profile Details
            </button>
          )}
          {user ? (
            <button
              onClick={handleLogout}
              className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-primary cursor-pointer"
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

      {/* Profile Details Modal */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="card w-full max-w-md p-6 border border-border bg-surface shadow-2xl relative animate-scale-in">
            <button
              onClick={() => setProfileModalOpen(false)}
              className="absolute right-4 top-4 p-1.5 rounded-lg hover:bg-surface-2 text-muted hover:text-fg transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            
            <div className="flex flex-col items-center text-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-fg text-xl font-bold shadow-sm">
                {initials}
              </div>
              <div>
                <h2 className="text-xl font-bold text-fg">{profile?.name || user?.displayName || 'User'}</h2>
                <p className="text-xs text-muted mt-1">{user?.email}</p>
              </div>
              
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                role === 'doctor' ? 'bg-emerald-soft text-emerald-400' : role === 'admin' ? 'bg-red-soft text-danger' : 'bg-primary-soft text-primary'
              }`}>
                {role || 'User'} Account
              </span>
              
              <div className="w-full border-t border-border/40 my-2" />
              
              <div className="w-full text-left space-y-3.5 text-sm">
                <div className="flex items-center gap-2 text-muted">
                  <Calendar className="h-4 w-4 text-primary shrink-0" />
                  <span>Joined MindEase: {profile?.registrationDate ? new Date(profile.registrationDate.seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Recently'}</span>
                </div>
                
                {role === 'doctor' && (
                  <div className="space-y-3 border-t border-border/20 pt-3 mt-1">
                    <div className="text-xs font-bold text-accent uppercase tracking-wider">Clinician Credentials</div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-lg border border-border p-2 bg-surface-2">
                        <div className="text-faint">Specialization</div>
                        <div className="font-bold text-fg mt-0.5">{profile?.specialization || 'General'}</div>
                      </div>
                      <div className="rounded-lg border border-border p-2 bg-surface-2">
                        <div className="text-faint">License Number</div>
                        <div className="font-bold text-fg mt-0.5">{profile?.licenseNumber || 'N/A'}</div>
                      </div>
                      <div className="rounded-lg border border-border p-2 bg-surface-2">
                        <div className="text-faint">Experience</div>
                        <div className="font-bold text-fg mt-0.5">{profile?.experience} Years</div>
                      </div>
                      <div className="rounded-lg border border-border p-2 bg-surface-2">
                        <div className="text-faint">Clinic Affiliation</div>
                        <div className="font-bold text-fg truncate mt-0.5">{profile?.clinicAffiliation || 'Private Clinic'}</div>
                      </div>
                    </div>
                    {profile?.bio && (
                      <div className="rounded-lg border border-border p-2.5 bg-surface-2 text-xs">
                        <div className="text-faint mb-1">Clinician Bio</div>
                        <p className="text-muted leading-relaxed italic">"{profile.bio}"</p>
                      </div>
                    )}
                  </div>
                )}
                
                {role === 'patient' && (
                  <div className="space-y-2 border-t border-border/20 pt-3 mt-1">
                    <div className="text-xs font-bold text-accent uppercase tracking-wider">Account Metrics</div>
                    <div className="flex items-center justify-between text-xs rounded-lg border border-border p-2.5 bg-surface-2">
                      <span className="text-faint">Onboarding Checklist</span>
                      <span className={`font-semibold ${profile?.onboarded ? 'text-primary' : 'text-warning'}`}>
                        {profile?.onboarded ? 'Completed' : 'Pending'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              
              <button
                onClick={() => setProfileModalOpen(false)}
                className="mt-4 w-full rounded-lg border border-border py-2 text-xs font-semibold text-muted hover:border-primary hover:text-primary transition"
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
