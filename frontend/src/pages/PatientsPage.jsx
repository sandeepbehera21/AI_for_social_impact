import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users,
  Search,
  Video,
  FileText,
  FileSignature,
  StickyNote,
  X,
  AlertTriangle,
  ShieldCheck,
  Flame,
  Target,
  Activity,
  ListChecks,
  Siren,
  Loader2,
  ChevronRight,
  Lock,
} from 'lucide-react'
import DoctorLayout from '../components/DoctorLayout.jsx'
import { RiskPill, EmptyState } from '../components/DoctorPrimitives.jsx'
import { RadialGauge } from '../components/DoctorCharts.jsx'
import MoodTrends from '../components/MoodTrends.jsx'
import CompleteSessionModal from '../components/CompleteSessionModal.jsx'
import { useDoctorPatients } from '../hooks/useDoctorPatients.js'
import { RISK_TIERS, relativeTime, toTs } from '../lib/doctorData.js'
import { LEVEL_META } from '../lib/wellness.js'
import { CRISIS_EVENT_LABELS } from '../lib/sos.js'
import { APPT_STATUS } from '../lib/appointments.js'

const TABS = [
  { key: 'high', ...RISK_TIERS.high },
  { key: 'medium', ...RISK_TIERS.medium },
  { key: 'low', ...RISK_TIERS.low },
]

export default function PatientsPage() {
  const navigate = useNavigate()
  const { patients, byTier, loadingSummaries, nowTs } = useDoctorPatients()
  const [tab, setTab] = useState('high')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [signing, setSigning] = useState(null)

  const list = useMemo(() => {
    const base = byTier[tab] || []
    if (!search.trim()) return base
    const q = search.toLowerCase()
    return base.filter((p) => p.patientName.toLowerCase().includes(q))
  }, [byTier, tab, search])

  // Most recent appointment for a patient (for quick "start"/"sign" actions).
  const latestAppt = (p, statuses) => {
    const matches = p.appointments.filter((a) => !statuses || statuses.includes(a.status))
    return matches.sort((a, b) => toTs(b.dateTime) - toTs(a.dateTime))[0]
  }

  const startConsult = (p) => {
    const appt = latestAppt(p, [APPT_STATUS.APPROVED]) || latestAppt(p)
    if (appt) navigate(`/consultation/${appt.id}`)
  }
  const writeNotes = (p) => {
    const appt = latestAppt(p, [APPT_STATUS.APPROVED, APPT_STATUS.COMPLETED]) || latestAppt(p)
    if (appt) setSigning(appt)
  }

  return (
    <DoctorLayout
      title="Patient Management"
      subtitle="Longitudinal view of every patient under your care, grouped by clinical risk."
    >
      {/* Risk Center summary strip */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`glass rounded-2xl p-4 text-left transition ${
              tab === t.key ? 'ring-2' : 'opacity-80 hover:opacity-100'
            }`}
            style={tab === t.key ? { '--tw-ring-color': t.color } : undefined}
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">{t.dot}</span>
              <span className="text-3xl font-bold tabular-nums text-fg">{byTier[t.key].length}</span>
            </div>
            <div className="mt-1 text-sm font-medium" style={{ color: t.color }}>
              {t.label}
            </div>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-5 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
        <Search className="h-4 w-4 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patients by name…"
          className="w-full bg-transparent text-sm text-fg placeholder:text-faint focus:outline-none"
        />
      </div>

      {/* Patient grid */}
      {loadingSummaries && patients.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading patient roster…
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Users}
          title={`No ${RISK_TIERS[tab].label.toLowerCase()} patients`}
          hint={patients.length === 0 ? 'Patients appear here once they book with you.' : 'Try another risk tab.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p, i) => (
            <PatientCard
              key={p.patientId}
              patient={p}
              delay={i * 0.04}
              onView={() => setSelected(p)}
              onReports={() => setSelected(p)}
              onStart={() => startConsult(p)}
              onNotes={() => writeNotes(p)}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      <AnimatePresence>
        {selected && (
          <PatientDrawer
            patient={selected}
            nowTs={nowTs}
            onClose={() => setSelected(null)}
            onStart={() => startConsult(selected)}
            onNotes={() => writeNotes(selected)}
          />
        )}
      </AnimatePresence>

      {signing && (
        <CompleteSessionModal
          appointment={signing}
          onClose={() => setSigning(null)}
          onCompleted={() => setSigning(null)}
        />
      )}
    </DoctorLayout>
  )
}

/* ---- Patient card ---- */
function PatientCard({ patient: p, delay, onView, onReports, onStart, onNotes }) {
  const tier = RISK_TIERS[p.risk.tier]
  const topAlert = p.alerts[0]
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass relative overflow-hidden rounded-2xl p-5"
      style={{ borderColor: `${tier.color}33` }}
    >
      <div className="absolute left-0 top-0 h-full w-1" style={{ background: tier.color }} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary">
            {p.patientName.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <div className="font-semibold text-fg">{p.patientName}</div>
            <div className="text-xs text-muted">
              {p.dominant ? (
                <span>
                  {p.dominant.emoji} {p.dominant.emotion} {p.trendArrow}
                </span>
              ) : (
                'No mood data'
              )}
            </div>
          </div>
        </div>
        <RiskPill tier={p.risk.tier} score={p.risk.score} size="sm" />
      </div>

      {/* Quick metrics */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Metric label="Wellness" value={p.wellnessScore ?? '—'} color={LEVEL_META[p.wellness?.wellness_score?.level]?.color || '#a78bfa'} />
        <Metric label="Last seen" value={p.lastSessionTs ? relativeTime(p.lastSessionTs).replace(' ago', '') : '—'} small />
        <Metric label="Sessions" value={p.completedSessions} />
      </div>

      {topAlert && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[11px] text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{topAlert.title}</span>
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <ActionBtn icon={FileText} label="Profile" onClick={onView} />
        <ActionBtn icon={ChevronRight} label="Reports" onClick={onReports} />
        <ActionBtn icon={Video} label="Consult" onClick={onStart} accent />
        <ActionBtn icon={StickyNote} label="Notes" onClick={onNotes} />
      </div>
    </motion.div>
  )
}

function Metric({ label, value, color, small }) {
  const defaultValColor = color || 'var(--fg)'
  return (
    <div className="rounded-lg bg-surface-2 p-2">
      <div className={`font-bold tabular-nums ${small ? 'text-xs' : 'text-lg'}`} style={{ color: defaultValColor }}>
        {value}
      </div>
      <div className="text-[10px] text-faint">{label}</div>
    </div>
  )
}

function ActionBtn({ icon: Icon, label, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition ${
        accent
          ? 'bg-primary text-primary-fg hover:bg-primary-hover'
          : 'border border-border text-muted hover:bg-surface-2'
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  )
}

/* ---- Detail drawer ---- */
function PatientDrawer({ patient: p, nowTs, onClose, onStart, onNotes }) {
  const w = p.wellness || {}
  const score = w.wellness_score || {}
  const levelMeta = LEVEL_META[score.level] || {}
  const habit = w.habit_summary
  const recentCrises = (w.crisis_events || []).filter((e) => nowTs - (e.ts || 0) < 30 * 86400000)
  const sharing = w.sharing || {}

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="glass fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border p-6"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-base font-bold text-primary-fg">
              {p.patientName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <h2 className="text-lg font-bold text-fg">{p.patientName}</h2>
              <RiskPill tier={p.risk.tier} score={p.risk.score} size="sm" />
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Risk factors */}
        {p.risk.factors.length > 0 && (
          <div className="mb-5 rounded-xl border border-border bg-surface-2 p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
              <AlertTriangle className="h-4 w-4 text-warning" /> Why flagged
            </h3>
            <ul className="space-y-1.5">
              {p.risk.factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between text-xs text-muted">
                  <span className="capitalize">{f.label}</span>
                  <span className="tabular-nums text-faint">{Math.round(f.weight * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Wellness gauge + habit stats */}
        <div className="mb-5 flex flex-col gap-4 rounded-xl border border-border bg-surface-2 p-4">
          <div className="flex items-center gap-4">
            <RadialGauge value={score.score || 0} color={levelMeta.color || 'var(--accent)'} label={levelMeta.label || 'Wellness'} size={104} />
            <div className="flex-1 space-y-2">
              <HabitStat icon={Flame} color="#fb923c" label="Day streak" value={sharing.habits === false ? '🔒 Restricted' : (habit?.streak ?? 0)} />
              <HabitStat icon={Activity} color="#34d399" label="Habit adherence" value={sharing.habits === false ? '🔒 Restricted' : (habit ? `${Math.round(habit.adherence * 100)}%` : '—')} />
              <HabitStat icon={Target} color="var(--accent)" label="Risk score" value={p.risk.score} />
            </div>
          </div>
          {sharing.habits === false && (
            <div className="text-[10px] text-warning flex items-center gap-1 border-t border-border pt-2 font-medium">
              <Lock className="h-3.5 w-3.5 shrink-0" /> Patient has restricted sharing for habits &amp; wellness.
            </div>
          )}
        </div>

        {/* Plan adherence */}
        {sharing.habits === false ? (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2 p-3 text-xs text-muted">
            <Lock className="h-3.5 w-3.5 text-warning shrink-0" />
            <span>Patient has restricted sharing for habits &amp; wellness plans.</span>
          </div>
        ) : w.plan ? (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-3 text-sm text-muted">
            <ListChecks className="h-4 w-4 text-accent" />
            <span className="font-medium text-fg">{w.plan.title}</span>
            {w.plan_adherence && (
              <span className="ml-auto text-xs text-faint">
                {w.plan_adherence.completed}/{w.plan_adherence.total} tasks
              </span>
            )}
          </div>
        ) : null}

        {/* Crisis events */}
        {recentCrises.length > 0 && (
          <div className="mb-5 rounded-xl border border-danger/30 bg-danger-soft p-3">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-danger">
              <Siren className="h-4 w-4" /> Crisis / SOS history (30d)
            </h3>
            <ul className="space-y-1 text-xs text-danger">
              {recentCrises.slice(0, 5).map((e, i) => (
                <li key={i} className="flex justify-between">
                  <span>{CRISIS_EVENT_LABELS[e.type] || e.type}</span>
                  <span className="text-faint">{relativeTime(e.ts)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Mood trends */}
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-fg">Emotional trend</h3>
          {sharing.mood === false ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted flex items-center justify-center gap-1.5 bg-surface-2">
              <Lock className="h-4 w-4 text-warning shrink-0" /> Patient has restricted sharing for mood trends.
            </div>
          ) : p.mood && p.mood.totalSamples > 0 ? (
            <MoodTrends summary={p.mood} compact defaultPeriod="weekly" />
          ) : (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-faint">
              No mood data shared yet.
            </p>
          )}
        </div>

        {/* Recommendations */}
        {(w.recommendations || []).length > 0 && (
          <div className="mb-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
              <ShieldCheck className="h-4 w-4 text-primary" /> Suggested focus
            </h3>
            <ul className="space-y-1.5">
              {w.recommendations.slice(0, 3).map((r, i) => (
                <li key={i} className="rounded-lg bg-surface-2 p-2.5 text-xs text-muted">
                  <span className="font-semibold text-accent">{r.title}</span>
                  {r.detail && <span className="text-faint"> — {r.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="mt-auto flex gap-2 pt-4">
          <button
            onClick={onStart}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg transition hover:bg-primary-hover"
          >
            <Video className="h-4 w-4" /> Start Consultation
          </button>
          <button
            onClick={onNotes}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-primary/50 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary-soft"
          >
            <FileSignature className="h-4 w-4" /> Write Notes
          </button>
        </div>
      </motion.aside>
    </>
  )
}

function HabitStat({ icon: Icon, color, label, value }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4" style={{ color }} />
      <span className="text-muted">{label}</span>
      <span className="ml-auto font-semibold tabular-nums text-fg">{value}</span>
    </div>
  )
}
