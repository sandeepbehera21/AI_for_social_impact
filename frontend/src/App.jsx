import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import { ROLES } from './lib/roles.js'
import { useAuth } from './context/AuthContext.jsx'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from './lib/firebase.js'
import { Megaphone } from 'lucide-react'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import NetworkStatus from './components/NetworkStatus.jsx'

// Route-based lazy loading
const HomePage = lazy(() => import('./pages/HomePage.jsx'))
const MeditationPage = lazy(() => import('./pages/MeditationPage.jsx'))
const ChatPage = lazy(() => import('./pages/ChatPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))
const SignInPage = lazy(() => import('./pages/SignInPage.jsx'))
const SignUpPage = lazy(() => import('./pages/SignUpPage.jsx'))
const PatientDashboard = lazy(() => import('./pages/PatientDashboard.jsx'))
const DoctorDashboard = lazy(() => import('./pages/DoctorDashboard.jsx'))
const PatientsPage = lazy(() => import('./pages/PatientsPage.jsx'))
const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage.jsx'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.jsx'))
const VideoConsultation = lazy(() => import('./pages/VideoConsultation.jsx'))
const SelectRolePage = lazy(() => import('./pages/SelectRolePage.jsx'))
const JournalPage = lazy(() => import('./pages/JournalPage.jsx'))
const CBTPage = lazy(() => import('./pages/CBTPage.jsx'))
const WellnessPage = lazy(() => import('./pages/WellnessPage.jsx'))
const HabitsPage = lazy(() => import('./pages/HabitsPage.jsx'))
const SOSPage = lazy(() => import('./pages/SOSPage.jsx'))
const ConsultDocPage = lazy(() => import('./pages/ConsultDocPage.jsx'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage.jsx'))
const TermsPage = lazy(() => import('./pages/TermsPage.jsx'))
const CookiesPage = lazy(() => import('./pages/CookiesPage.jsx'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage.jsx'))
const AboutPage = lazy(() => import('./pages/AboutPage.jsx'))
const ContactPage = lazy(() => import('./pages/ContactPage.jsx'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'))

function RouteLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm font-medium text-muted animate-pulse">Loading MindEase...</p>
      </div>
    </div>
  )
}

// React Router v7 does not scroll to a `#hash` target on its own. The chat's
// "Learn About Privacy" button links to `/#privacy`, so without this the user
// lands at the top of the home page instead of the Privacy section. On every
// location change we scroll the matching element into view (deferred a frame so
// the destination route has mounted), falling back to top when there's no hash.
function ScrollToHash() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1))
      const tryScroll = () => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ behavior: 'smooth' })
      }
      // Wait a frame for the target route/section to render before scrolling.
      const raf = requestAnimationFrame(tryScroll)
      return () => cancelAnimationFrame(raf)
    }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  return null
}

export default function App() {
  const location = useLocation()
  const { role, user } = useAuth()
  const [announcements, setAnnouncements] = useState([])

  useEffect(() => {
    if (!user) {
      setAnnouncements([])
      return
    }
    const q = query(
      collection(db, 'broadcasts'),
      where('active', '==', true)
    )
    return onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const filtered = items.filter(b => b.target === 'all' || b.target === role)
      filtered.sort((a, b) => b.createdAt - a.createdAt)
      setAnnouncements(filtered)
    }, (err) => {
      console.error('[App] Failed to listen to broadcasts:', err)
    })
  }, [user, role])

  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToHash />
      <NetworkStatus />
      {announcements.length > 0 && (
        <div className={`text-center py-2 px-4 text-xs font-bold transition flex items-center justify-center gap-2 ${
          announcements[0].type === 'warning'
            ? 'bg-warning text-warning-fg'
            : announcements[0].type === 'maintenance'
              ? 'bg-danger text-white'
              : 'bg-primary text-primary-fg'
        }`}>
          <Megaphone className="h-3.5 w-3.5 shrink-0" />
          <span>{announcements[0].message}</span>
        </div>
      )}
      <Navbar />
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <Suspense fallback={<RouteLoader />}>
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<ErrorBoundary><HomePage /></ErrorBoundary>} />
              <Route path="/meditation" element={<ErrorBoundary><MeditationPage /></ErrorBoundary>} />
              <Route path="/chat" element={<ErrorBoundary><ChatPage /></ErrorBoundary>} />
              <Route path="/privacy" element={<ErrorBoundary><PrivacyPage /></ErrorBoundary>} />
              <Route path="/terms" element={<ErrorBoundary><TermsPage /></ErrorBoundary>} />
              <Route path="/cookies" element={<ErrorBoundary><CookiesPage /></ErrorBoundary>} />
              <Route path="/about" element={<ErrorBoundary><AboutPage /></ErrorBoundary>} />
              <Route path="/contact" element={<ErrorBoundary><ContactPage /></ErrorBoundary>} />

              {/* Auth */}
              <Route path="/login" element={<ErrorBoundary><SignInPage /></ErrorBoundary>} />
              <Route path="/signup" element={<ErrorBoundary><SignUpPage /></ErrorBoundary>} />
              <Route
                path="/select-role"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute>
                      <SelectRolePage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />

              {/* Role-guarded dashboards */}
              <Route
                path="/onboarding"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.PATIENT}>
                      <OnboardingPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/dashboard/patient"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.PATIENT}>
                      <PatientDashboard />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/journal"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.PATIENT}>
                      <JournalPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/cbt"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.PATIENT}>
                      <CBTPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/wellness"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.PATIENT}>
                      <WellnessPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/habits"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.PATIENT}>
                      <HabitsPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/sos"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.PATIENT}>
                      <SOSPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/consult-doc"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.PATIENT}>
                      <ConsultDocPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/dashboard/doctor"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.DOCTOR}>
                      <DoctorDashboard />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/doctor/patients"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.DOCTOR}>
                      <PatientsPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/doctor/appointments"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.DOCTOR}>
                      <AppointmentsPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/doctor/analytics"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.DOCTOR}>
                      <AnalyticsPage />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/dashboard/admin"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute allow={ROLES.ADMIN}>
                      <AdminDashboard />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />

              {/* Video room — any signed-in participant */}
              <Route
                path="/consultation/:appointmentId"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute>
                      <VideoConsultation />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />

              <Route path="*" element={<ErrorBoundary><NotFoundPage /></ErrorBoundary>} />
            </Routes>
          </Suspense>
        </AnimatePresence>
      </main>
      <Footer />
    </div>
  )
}
