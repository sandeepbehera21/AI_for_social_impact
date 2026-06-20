import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  HeartPulse,
  BookOpen,
  BrainCircuit,
  Sparkles,
  Target,
  Flame,
  Activity,
  LifeBuoy,
  ListChecks,
  ChevronRight,
  Waves,
  Lock,
  Download,
  Shield,
  Check,
  Loader2,
  Clock,
} from 'lucide-react'
import MoodTrendsCharts from '../components/MoodTrendsCharts.jsx'
import PageTransition from '../components/PageTransition.jsx'
import EmailVerificationBanner from '../components/EmailVerificationBanner.jsx'
import { collection, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { subscribeMoodEntries, aggregateMood } from '../lib/moodHistory.js'
import { subscribeHabits, aggregateHabits } from '../lib/habits.js'
import { exportPatientData } from '../lib/dataExport.js'
import { requestAppointment, subscribeAppointments, APPT_STATUS } from '../lib/appointments.js'
import {
  subscribeActivePlan,
  computeWellnessScore,
  generateRecommendations,
  planAdherenceToday,
  subscribeRecommendationHistory,
  saveRecommendationsSnapshot,
  prevRecommendationIds,
  LEVEL_META,
} from '../lib/wellness.js'
import {
  subscribeNotifications,
  checkAndGenerateNotifications
} from '../lib/notifications.js'


export default function PatientDashboard() {
  const { profile, user } = useAuth()
  const navigate = useNavigate()

  if (window.location.search.includes('trigger-error=true')) {
    throw new Error('Simulated patient dashboard runtime crash for Error Boundary verification.')
  }

  // ── Waitlist, Export, and Consent states ───────────────────────────────────
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [consentSaving, setConsentSaving] = useState(false)
  const [waitlistNotifications, setWaitlistNotifications] = useState([])

  // Get sharing consent from profile or default to true (opt-out)
  const sharingConsent = useMemo(() => {
    return {
      journal: true,
      habits: true,
      mood: true,
      cbt: true,
      ...profile?.sharing
    }
  }, [profile?.sharing])

  // Update consent settings
  const toggleConsent = async (type) => {
    if (!profile?.uid) return
    setConsentSaving(true)
    try {
      const docRef = doc(db, 'users', profile.uid)
      await updateDoc(docRef, {
        [`sharing.${type}`]: !sharingConsent[type]
      })
    } catch (err) {
      console.error('[PatientDashboard] Error updating consent:', err)
    } finally {
      setConsentSaving(false)
    }
  }

  // Handle data export download
  const handleExport = async () => {
    setExporting(true)
    setExportError('')
    try {
      await exportPatientData(profile)
    } catch (err) {
      setExportError(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  // Subscribe to waitlist notifications
  useEffect(() => {
    if (!profile?.uid) return
    const q = query(
      collection(db, 'waitlist'),
      where('patientId', '==', profile.uid),
      where('status', '==', 'notified')
    )
    const unsub = onSnapshot(q, (snap) => {
      setWaitlistNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [profile?.uid])

  // ── Appointments & Notifications ───────────────────────────────────────────
  const [appointments, setAppointments] = useState([])
  const [userNotifications, setUserNotifications] = useState(null)

  useEffect(() => {
    if (!profile?.uid) return
    return subscribeAppointments('patientId', profile.uid, setAppointments, () => {})
  }, [profile?.uid])

  useEffect(() => {
    if (!profile?.uid) {
      setUserNotifications(null)
      return
    }
    return subscribeNotifications(profile.uid, setUserNotifications, () => {})
  }, [profile?.uid])

  // ── Mood history (own facial-emotion samples) ─────────────────────────────
  const [moodEntries, setMoodEntries] = useState([])
  useEffect(() => {
    if (!profile?.uid) return
    return subscribeMoodEntries(profile.uid, setMoodEntries, () => {})
  }, [profile?.uid])
  const moodSummary = useMemo(() => aggregateMood(moodEntries), [moodEntries])

  // ── Wellness ecosystem: habits, journals, CBT, active plan (Phase 2) ──────
  const [habitEntries, setHabitEntries] = useState([])
  const [journals, setJournals] = useState([])
  const [cbtExercises, setCbtExercises] = useState([])
  const [wellnessPlan, setWellnessPlan] = useState(null)

  useEffect(() => {
    if (!profile?.uid) return
    return subscribeHabits(profile.uid, setHabitEntries, () => {})
  }, [profile?.uid])
  useEffect(() => {
    if (!profile?.uid) return
    return subscribeActivePlan(profile.uid, setWellnessPlan, () => {})
  }, [profile?.uid])
  useEffect(() => {
    if (!profile?.uid) return
    const q = query(collection(db, 'journals'), where('patientId', '==', profile.uid))
    return onSnapshot(q, (snap) => setJournals(snap.docs.map((d) => d.data())), () => {})
  }, [profile?.uid])
  useEffect(() => {
    if (!profile?.uid) return
    const q = query(collection(db, 'cbt_exercises'), where('patientId', '==', profile.uid))
    return onSnapshot(q, (snap) => setCbtExercises(snap.docs.map((d) => d.data())), () => {})
  }, [profile?.uid])

  const [auditLogs, setAuditLogs] = useState([])
  useEffect(() => {
    if (!profile?.uid) return
    const q = query(
      collection(db, 'consent_audit'),
      where('patientId', '==', profile.uid)
    )
    const unsub = onSnapshot(q, (snap) => {
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      logs.sort((a, b) => b.accessedAt - a.accessedAt)
      setAuditLogs(logs)
    }, (err) => {
      console.error('[PatientDashboard] Error loading consent audit logs:', err)
    })
    return unsub
  }, [profile?.uid])

  // ── Recommendation memory: prior days' snapshots feed "previous recs" so the
  //    engine refreshes guidance instead of repeating it, and the doctor sees a
  //    history of AI guidance. Snapshots persist to `recommendations/{uid}_{day}`.
  const [recHistory, setRecHistory] = useState([])
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  useEffect(() => {
    if (!profile?.uid) return
    return subscribeRecommendationHistory(profile.uid, setRecHistory, () => {})
  }, [profile?.uid])
  const prevRecIds = useMemo(
    () => prevRecommendationIds(recHistory, 7, today),
    [recHistory, today],
  )

  const habitSummary = useMemo(() => aggregateHabits(habitEntries), [habitEntries])
  const planAdherence = useMemo(() => planAdherenceToday(wellnessPlan), [wellnessPlan])
  const wellnessSignals = useMemo(
    () => ({
      moodSummary,
      habitSummary,
      journals,
      cbt: cbtExercises,
      planAdherence,
      prevRecommendations: prevRecIds,
    }),
    [moodSummary, habitSummary, journals, cbtExercises, planAdherence, prevRecIds],
  )
  const wellnessScore = useMemo(() => computeWellnessScore(wellnessSignals), [wellnessSignals])
  const recommendations = useMemo(
    () => generateRecommendations(wellnessSignals).slice(0, 3),
    [wellnessSignals],
  )

  const upcomingAppointments = useMemo(() => {
    return appointments.filter(
      (a) => a.status === APPT_STATUS.PENDING || a.status === APPT_STATUS.APPROVED
    )
  }, [appointments])

  // Persist the recommendations the patient is actually shown (idempotent per day).
  useEffect(() => {
    if (!profile?.uid || !recommendations.length) return
    saveRecommendationsSnapshot(profile.uid, recommendations).catch(() => {})
  }, [profile?.uid, recommendations])

  // Trigger automatic generation of unread reminders based on patient's current signals
  useEffect(() => {
    if (!profile?.uid || !wellnessSignals || !userNotifications) return
    const runCheck = async () => {
      try {
        await checkAndGenerateNotifications(
          profile.uid,
          {
            ...wellnessSignals,
            appointments,
            recommendations,
          },
          userNotifications
        )
      } catch (err) {
        console.error('[PatientDashboard] failed to generate notifications:', err)
      }
    }
    runCheck()
  }, [profile?.uid, wellnessSignals, appointments, recommendations, userNotifications])


  // Route a recommendation's action hint to the right destination.
  const goToRecommendation = (action) => {
    if (action === 'meditation') navigate('/meditation')
    else if (action === 'journal') navigate('/journal')
    else if (action === 'doctor') navigate('/consult-doc')
    else if (action?.startsWith('cbt:')) navigate('/cbt', { state: { autoOpen: action.split(':')[1] } })
    else if (action?.startsWith('habit:')) navigate('/habits')
    else navigate('/wellness')
  }



  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageTransition className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* ── Welcome Header Card ── */}
      <header className="mb-8 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary-soft/10 via-surface-2 to-surface p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="text-2xl font-extrabold text-accent">
            Welcome to MindEase{profile?.name ? `, ${profile.name}` : ''}!
          </h1>
          <p className="mt-1.5 text-xs text-muted max-w-xl leading-relaxed">
            We are glad you are here. Review your self-care workspaces, active plans, and mental health metrics to support your wellness journey.
          </p>
        </div>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary shadow-inner">
          <BrainCircuit className="h-6 w-6" />
        </div>
      </header>

      {/* Email Verification Alert Banner */}
      <EmailVerificationBanner user={user} />

      {/* Waitlist Notifications Banner */}
      {waitlistNotifications.length > 0 && (
        <div className="mb-6 space-y-3">
          {waitlistNotifications.map((notif) => (
            <div
              key={notif.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-accent/40 bg-accent-soft p-4 text-sm text-accent"
            >
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <div className="font-semibold text-fg">Slot Available with Dr. {notif.doctorName}!</div>
                  <div className="text-xs text-muted">
                    The slot on {new Date(notif.dateTime).toLocaleString()} is now open. Would you like to book it?
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      await requestAppointment({
                        patient: profile,
                        doctor: { uid: notif.doctorId, name: notif.doctorName, email: '' },
                        dateTime: notif.dateTime,
                      })
                      await updateDoc(doc(db, 'waitlist', notif.id), { status: 'booked' })
                    } catch (err) {
                      console.error('[PatientDashboard] Error booking waitlist slot:', err)
                    }
                  }}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-fg hover:bg-primary-hover transition cursor-pointer"
                >
                  Book Now
                </button>
                <button
                  onClick={async () => {
                    try {
                      await updateDoc(doc(db, 'waitlist', notif.id), { status: 'dismissed' })
                    } catch (err) {
                      console.error('[PatientDashboard] Error dismissing waitlist slot:', err)
                    }
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 transition cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Upcoming Consultations ── */}
      {upcomingAppointments.length > 0 && (
        <section className="card mb-6 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-fg">
            <Clock className="h-5 w-5 text-accent" /> Upcoming Consultations
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingAppointments.map((a) => {
              const isApproved = a.status === APPT_STATUS.APPROVED
              const hasConsent = a.shareConsent === true
              return (
                <div
                  key={a.id}
                  className="flex flex-col justify-between rounded-xl border border-border bg-surface-2 p-4"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-fg">Dr. {a.doctorName}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          a.status === APPT_STATUS.APPROVED
                            ? 'bg-success/20 text-success'
                            : 'bg-warning/20 text-warning'
                        }`}
                      >
                        {a.status === APPT_STATUS.APPROVED ? 'Approved' : 'Pending'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {new Date(a.dateTime).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </div>
                  </div>

                  {isApproved && (
                    <div className="mt-4 border-t border-border/60 pt-3">
                      {hasConsent ? (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
                          <Check className="h-4 w-4" /> Consented to Share Details
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <p className="text-[11px] text-muted">
                            Consent is required for your practitioner to review your emotional and wellness summaries.
                          </p>
                          <button
                            onClick={async () => {
                              try {
                                await updateDoc(doc(db, 'appointments', a.id), { shareConsent: true })
                              } catch (err) {
                                console.error('[PatientDashboard] Error granting consent:', err)
                              }
                            }}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-fg hover:bg-primary-hover transition cursor-pointer"
                          >
                            <Shield className="h-3.5 w-3.5" /> Share Health Data
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Mood trends (from on-device emotion tracking in chat) ── */}
      <section className="card mb-6 p-6">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-accent">
          <HeartPulse className="h-5 w-5" /> Your Mood Trends
        </h2>
        <p className="mb-4 text-sm text-muted">
          Built from your on-device facial-emotion tracking during chats. Your
          camera frames never leave your device — only the dominant emotion is saved.
        </p>
        <MoodTrendsCharts entries={moodEntries} />
      </section>

      {/* ── Wellness Ecosystem: score + plan + habits + SOS ── */}
      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        {/* Wellness score */}
        <button
          onClick={() => navigate('/wellness')}
          className="card p-5 text-left transition hover:border-primary/40"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted">Wellness Score</span>
            <Target className="h-5 w-5" style={{ color: (LEVEL_META[wellnessScore.level] || {}).color }} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-fg">{wellnessScore.score}</span>
            <span className="text-xs text-faint">/100</span>
          </div>
          <span
            className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{
              backgroundColor: `${(LEVEL_META[wellnessScore.level] || {}).color}22`,
              color: (LEVEL_META[wellnessScore.level] || {}).color,
            }}
          >
            {(LEVEL_META[wellnessScore.level] || {}).label}
          </span>
        </button>

        {/* Wellness plan progress */}
        <button
          onClick={() => navigate('/wellness')}
          className="card p-5 text-left transition hover:border-primary/40"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted">Wellness Plan</span>
            <ListChecks className="h-5 w-5 text-accent" />
          </div>
          {wellnessPlan ? (
            <>
              <div className="mt-2 truncate text-base font-bold text-fg">{wellnessPlan.title}</div>
              <div className="mt-1 text-xs text-muted">
                {planAdherence.completed}/{planAdherence.total} tasks done today
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round(planAdherence.ratio * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <div className="mt-2 text-sm text-muted">
              No plan yet —{' '}
              <span className="font-semibold text-accent">generate one →</span>
            </div>
          )}
        </button>

        {/* Habit streak */}
        <button
          onClick={() => navigate('/habits')}
          className="card p-5 text-left transition hover:border-primary/40"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted">Habit Streak</span>
            <Flame className="h-5 w-5 text-warning" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-fg">{habitSummary.streak}</span>
            <span className="text-xs text-faint">days</span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {Math.round(habitSummary.adherence * 100)}% adherence this week
          </div>
        </button>
      </section>

      {/* ── AI Recommendations (multi-signal engine) ── */}
      {recommendations.length > 0 && (
        <section className="card mb-6 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-fg">
            <Sparkles className="h-5 w-5 text-warning" /> Recommended for You
          </h2>
          <div className="space-y-3">
            {recommendations.map((r) => (
              <button
                key={r.id}
                onClick={() => goToRecommendation(r.action)}
                className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-surface-2 p-4 text-left transition hover:border-primary/40 hover:bg-elevated"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      r.category === 'clinical' ? 'bg-danger-soft' : 'bg-accent-soft'
                    }`}
                  >
                    {r.category === 'clinical' ? (
                      <LifeBuoy className="h-4 w-4 text-danger" />
                    ) : r.category === 'habit' ? (
                      <Activity className="h-4 w-4 text-success" />
                    ) : r.category === 'meditation' ? (
                      <HeartPulse className="h-4 w-4 text-primary" />
                    ) : (
                      <BrainCircuit className="h-4 w-4 text-accent" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-fg">{r.title}</div>
                    <div className="mt-0.5 text-xs text-muted">{r.detail}</div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Self-Care Workspaces ── */}
      <section className="grid gap-6 sm:grid-cols-2 mb-6">
        <div className="card p-6 flex flex-col justify-between hover:border-primary/40 transition">
          <div>
            <h3 className="text-lg font-bold text-fg flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <BookOpen className="h-5 w-5" />
              </span>
              Journal Workspace
            </h3>
            <p className="mt-2 text-sm text-muted">
              Reflect on your daily thoughts, track your emotions, and tag them under key life stressors.
            </p>
          </div>
          <button
            onClick={() => navigate('/journal')}
            className="mt-4 inline-flex items-center justify-center rounded-xl border border-primary/40 bg-primary-soft px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary hover:text-primary-fg transition cursor-pointer"
          >
            Open Journal Workspace
          </button>
        </div>

        <div className="card p-6 flex flex-col justify-between hover:border-primary/40 transition">
          <div>
            <h3 className="text-lg font-bold text-fg flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <BrainCircuit className="h-5 w-5" />
              </span>
              CBT Worksheets
            </h3>
            <p className="mt-2 text-sm text-muted">
              Use thought reframing worksheets, anxiety mappings, stress checklists, and daily gratitude logs.
            </p>
          </div>
          <button
            onClick={() => navigate('/cbt')}
            className="mt-4 inline-flex items-center justify-center rounded-xl border border-primary/40 bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent hover:bg-primary hover:text-primary-fg transition cursor-pointer"
          >
            Explore CBT Exercises
          </button>
        </div>

        <div className="card p-6 flex flex-col justify-between hover:border-primary/40 transition">
          <div>
            <h3 className="text-lg font-bold text-fg flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
                <HeartPulse className="h-5 w-5" />
              </span>
              Wellness Hub
            </h3>
            <p className="mt-2 text-sm text-muted">
              Track your daily wellness score, complete active lifestyle plans, and build positive habits.
            </p>
          </div>
          <button
            onClick={() => navigate('/wellness')}
            className="mt-4 inline-flex items-center justify-center rounded-xl border border-border bg-success-soft px-4 py-2.5 text-sm font-semibold text-success hover:bg-primary hover:text-primary-fg transition cursor-pointer"
          >
            Open Wellness Hub
          </button>
        </div>

        <div className="card p-6 flex flex-col justify-between hover:border-primary/40 transition">
          <div>
            <h3 className="text-lg font-bold text-fg flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Waves className="h-5 w-5" />
              </span>
              Guided Meditation
            </h3>
            <p className="mt-2 text-sm text-muted">
              Relax your mind with our AI-powered breathing techniques and calming background sounds.
            </p>
          </div>
          <button
            onClick={() => navigate('/meditation')}
            className="mt-4 inline-flex items-center justify-center rounded-xl border border-primary/40 bg-primary-soft px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary hover:text-primary-fg transition cursor-pointer"
          >
            Start Meditation
          </button>
        </div>
      </section>

      {/* 🔒 Privacy & Data Consent Settings */}
      <section className="card p-6 mb-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-fg">
          <Lock className="h-5 w-5 text-accent" /> Privacy &amp; Consent Settings
        </h2>
        <p className="mb-6 text-sm text-muted">
          Under GDPR and DPDPA, you have full control over your private data. Manage what information is shared with your assigned clinical practitioner, or download your complete export archive.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Consent Toggles */}
          <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-5">
            <h3 className="font-semibold text-fg text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Clinical Data Sharing
            </h3>

            <div className="space-y-3">
              {[
                { key: 'journal', label: 'Share Journal reflections' },
                { key: 'habits', label: 'Share Habits & Wellness plans' },
                { key: 'mood', label: 'Share Facial Mood Trends' },
                { key: 'cbt', label: 'Share CBT Worksheet exercises' },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-xs text-muted font-medium">{item.label}</span>
                  <button
                    disabled={consentSaving}
                    onClick={() => toggleConsent(item.key)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none ${
                      sharingConsent[item.key] ? 'bg-primary' : 'bg-surface-3'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        sharingConsent[item.key] ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Data Portability */}
          <div className="flex flex-col justify-between rounded-xl border border-border bg-surface-2 p-5">
            <div>
              <h3 className="font-semibold text-fg text-sm flex items-center gap-2 mb-2">
                <Download className="h-4 w-4 text-accent" /> Right to Data Portability
              </h3>
              <p className="text-xs text-muted leading-relaxed">
                Download your complete profile data, plaintext journals, completed CBT sheets, and mood/habit logs packaged in a ZIP archive.
              </p>
              {exportError && (
                <p className="mt-3 text-xs text-danger border border-danger/25 bg-danger-soft p-2 rounded-lg">
                  {exportError}
                </p>
              )}
            </div>

            <button
              onClick={handleExport}
              disabled={exporting}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-accent-fg hover:bg-accent/80 transition cursor-pointer disabled:opacity-50"
            >
              {exporting ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Packaging Archive…</>
              ) : (
                <><Download className="h-3.5 w-3.5" /> Download My Data (ZIP)</>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* ── Clinician Access Log ── */}
      <section className="mt-12 rounded-3xl border border-border bg-surface-1 p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-bold text-fg flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" /> Clinician Access Log
        </h2>
        <p className="mb-6 text-sm text-muted">
          Under GDPR/DPDPA, you have the right to monitor who has accessed your clinical summary and records. Below is a real-time audit log of all practitioner reads.
        </p>

        {auditLogs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted">
            No clinician reads have been recorded yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface-2">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-3 font-semibold text-fg">
                    <th className="p-4">Practitioner</th>
                    <th className="p-4">Data Accessed</th>
                    <th className="p-4">Timestamp</th>
                    <th className="p-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-surface-3/30 transition-colors">
                      <td className="p-4 font-bold text-fg">{log.doctorName} (ID: {log.doctorId.slice(0, 6)}...)</td>
                      <td className="p-4">
                        <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary uppercase">
                          {log.accessedCategory.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="p-4 text-muted">
                        {new Date(log.accessedAt).toLocaleString()}
                      </td>
                      <td className="p-4 text-right">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full uppercase">
                          <Check className="h-3 w-3" /> Authorised
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

    </PageTransition>
  )
}
