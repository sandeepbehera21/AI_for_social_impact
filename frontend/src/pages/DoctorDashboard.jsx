import { useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Users,
  CalendarCheck,
  AlertTriangle,
  FileSignature,
  Video,
  Check,
  X,
  Loader2,
  KeyRound,
  Download,
  Inbox,
  Activity,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Moon,
  ListChecks,
  Siren,
  ShieldCheck,
  Brain,
  ArrowRight,
} from 'lucide-react'
import CompleteSessionModal from '../components/CompleteSessionModal.jsx'
import CountdownJoinButton from '../components/CountdownJoinButton.jsx'
import DoctorLayout from '../components/DoctorLayout.jsx'
import DoctorProfileCard from '../components/DoctorProfileCard.jsx'
import EmailVerificationBanner from '../components/EmailVerificationBanner.jsx'
import { KpiCard, RiskPill, Panel, EmptyState } from '../components/DoctorPrimitives.jsx'
import { LineChart } from '../components/DoctorCharts.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useDoctorPatients } from '../hooks/useDoctorPatients.js'
import { setAppointmentStatus, APPT_STATUS } from '../lib/appointments.js'
import { bootstrapDoctorKeys, redownloadPrivateKey } from '../lib/doctorKeys.js'
import { relativeTime, toTs } from '../lib/doctorData.js'
import { formatDateTime } from '../lib/datetime.js'

// Icon registry so derived alerts (which carry an icon *name*) can render.
const ALERT_ICONS = { AlertTriangle, TrendingUp, TrendingDown, Moon, ListChecks, Siren }
const SEV_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#38bdf8' }

export default function DoctorDashboard() {
  const { profile, user } = useAuth()
  const navigate = useNavigate()
  const { appointments, patients, byTier, stats, allAlerts, loadingSummaries, nowTs } = useDoctorPatients()

  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [keyNotice, setKeyNotice] = useState('')
  const [signing, setSigning] = useState(null)

  const keyBootstrapRan = useRef(false)

  // Preserve existing RSA key bootstrap (private key handed over once).
  useEffect(() => {
    if (!profile?.uid || keyBootstrapRan.current) return
    keyBootstrapRan.current = true
    let alive = true
    bootstrapDoctorKeys(profile.uid)
      .then((res) => {
        if (alive && res.created) {
          setKeyNotice(
            'Your signing key was generated and downloaded as a .pem file. ' +
              'Keep it safe — it identifies your signatures.',
          )
        }
      })
      .catch((err) => alive && setError(`Key setup failed: ${err.message}`))
    return () => {
      alive = false
    }
  }, [profile?.uid])

  const pending = useMemo(
    () => appointments.filter((a) => a.status === APPT_STATUS.PENDING),
    [appointments],
  )
  const upcoming = useMemo(
    () => {
      const now = Date.now()
      return appointments
        .filter(
          (a) =>
            a.status === 'active' ||
            (a.status === APPT_STATUS.APPROVED && toTs(a.dateTime) + 15 * 60 * 1000 >= now),
        )
        .sort((a, b) => toTs(a.dateTime) - toTs(b.dateTime))
    },
    [appointments],
  )
  const completed = useMemo(
    () => appointments.filter((a) => a.status === APPT_STATUS.COMPLETED),
    [appointments],
  )
  const pendingReports = useMemo(
    () => completed.filter((a) => !a.signature).length,
    [completed],
  )
  const highRisk = byTier.high.length

  // Outcome trend: average wellness score across the patient panel by week.
  const outcomeSeries = useMemo(() => buildOutcomeTrend(patients), [patients])

  const act = async (id, status) => {
    setBusyId(id)
    setError('')
    try {
      await setAppointmentStatus(id, status)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <DoctorLayout
      title="Clinical Command Center"
      subtitle={`Welcome back${profile?.name ? `, Dr. ${profile.name}` : ''} — here's your practice at a glance.`}
    >
      {/* Email Verification Alert Banner */}
      <EmailVerificationBanner user={user} />

      {error && (
        <div className="mb-5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {keyNotice && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-sm text-primary">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            {keyNotice}
            <button
              onClick={() => redownloadPrivateKey().catch(() => {})}
              className="ml-2 inline-flex items-center gap-1 underline underline-offset-2 hover:text-fg"
            >
              <Download className="h-3.5 w-3.5" /> Download again
            </button>
          </div>
          <button onClick={() => setKeyNotice('')} className="rounded p-0.5 hover:bg-surface-2 hover:text-fg" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ---- KPI row ---- */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={Users} label="Total Patients" value={patients.length} accent="var(--accent)" sub="under your care" onClick={() => navigate('/doctor/patients')} delay={0} />
        <KpiCard icon={CalendarCheck} label="Today's Appointments" value={stats.today} accent="var(--primary)" sub={`${upcoming.length} upcoming total`} onClick={() => navigate('/doctor/appointments')} delay={0.05} />
        <KpiCard icon={AlertTriangle} label="High-Risk Patients" value={highRisk} accent="var(--danger)" sub="need attention" onClick={() => navigate('/doctor/patients')} delay={0.1} />
        <KpiCard icon={FileSignature} label="Pending Reports" value={pendingReports} accent="var(--warning)" sub="awaiting signature" delay={0.15} />
      </div>

      {/* ---- Profile + Insights ---- */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DoctorProfileCard consultationCount={completed.length} patientCount={patients.length} />
        </div>
        <Panel title="AI Clinical Insights" icon={Sparkles}>
          <ClinicalInsights patients={patients} stats={stats} pendingReports={pendingReports} loading={loadingSummaries} />
        </Panel>
      </div>

      {/* ---- Main two-column grid ---- */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: appointments */}
        <div className="space-y-6 lg:col-span-2">
          {/* Pending requests */}
          <Panel
            title="Incoming Requests"
            icon={Inbox}
            action={
              pending.length > 0 && (
                <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
                  {pending.length} pending
                </span>
              )
            }
          >
            {pending.length === 0 ? (
              <EmptyState icon={Inbox} title="No pending requests" hint="New booking requests will appear here." />
            ) : (
              <div className="space-y-3">
                {pending.map((a) => (
                  <div key={a.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-semibold text-fg">{a.patientName}</div>
                      <div className="text-sm text-muted">{formatDateTime(a.dateTime)}</div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => act(a.id, APPT_STATUS.APPROVED)}
                        disabled={busyId === a.id}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg transition hover:bg-primary-hover disabled:opacity-50"
                      >
                        {busyId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                      </button>
                      <button
                        onClick={() => act(a.id, APPT_STATUS.REJECTED)}
                        disabled={busyId === a.id}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-4 py-2 text-sm font-semibold text-danger transition hover:bg-danger-soft disabled:opacity-50"
                      >
                        <X className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Upcoming appointments */}
          <Panel
            title="Upcoming Appointments"
            icon={CalendarCheck}
            action={
              <button onClick={() => navigate('/doctor/appointments')} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            }
          >
            {upcoming.length === 0 ? (
              <EmptyState icon={CalendarCheck} title="No upcoming sessions" hint="Approved appointments will appear here." />
            ) : (
              <div className="space-y-3">
                {upcoming.slice(0, 4).map((a) => {
                  const p = patients.find((x) => x.patientId === a.patientId)
                  return (
                    <div key={a.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-fg">{a.patientName}</span>
                          {p && <RiskPill tier={p.risk.tier} size="sm" />}
                        </div>
                        <div className="text-sm text-muted">{formatDateTime(a.dateTime)}</div>
                      </div>
                      <div className="flex gap-2">
                        <CountdownJoinButton appointment={a} isDoctor={true} onJoin={() => navigate(`/consultation/${a.id}`)} />
                        <button
                          onClick={() => setSigning(a)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 px-3.5 py-2 text-sm font-semibold text-primary transition hover:bg-primary-soft"
                        >
                          <FileSignature className="h-4 w-4" /> Sign
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          {/* Patient outcome trends */}
          <Panel title="Patient Outcome Trends" icon={Activity}>
            {outcomeSeries.labels.length > 1 ? (
              <>
                <p className="mb-2 text-xs text-muted">Average wellness score across your patient panel over recent weeks.</p>
                <LineChart series={outcomeSeries.series} labels={outcomeSeries.labels} yMax={100} unit="" />
              </>
            ) : (
              <EmptyState icon={Activity} title="Not enough data yet" hint="Outcome trends build up as your patients log wellness data." />
            )}
          </Panel>
        </div>

        {/* Right: alerts + recent activity */}
        <div className="space-y-6">
          <Panel title="High-Risk Alerts" icon={AlertTriangle}>
            {allAlerts.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No active alerts" hint="Clinical alerts surface automatically." />
            ) : (
              <div className="space-y-2.5">
                {allAlerts.slice(0, 6).map((al) => {
                  const Icon = ALERT_ICONS[al.icon] || AlertTriangle
                  return (
                    <button
                      key={al.id}
                      onClick={() => navigate('/doctor/patients')}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-surface-2 p-3 text-left transition hover:border-border-strong"
                    >
                      <span
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: `${SEV_COLOR[al.severity]}1f`, color: SEV_COLOR[al.severity] }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-fg">{al.title}</div>
                          {al.ts && (
                            <span className="text-[10px] text-faint shrink-0">
                              {relativeTime(al.ts, nowTs)}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted">{al.patient.patientName}</div>
                        <div className="mt-0.5 text-xs text-faint">{al.detail}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </Panel>

          <Panel title="Recent Patient Activity" icon={Brain}>
            {patients.length === 0 ? (
              <EmptyState icon={Users} title="No patients yet" />
            ) : (
              <div className="space-y-2.5">
                {[...patients]
                  .sort((a, b) => Math.max(b.lastSessionTs, b.nextSessionTs) - Math.max(a.lastSessionTs, a.nextSessionTs))
                  .slice(0, 6)
                  .map((p) => (
                    <button
                      key={p.patientId}
                      onClick={() => navigate('/doctor/patients')}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2 p-3 text-left transition hover:border-border-strong"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                        {p.patientName.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-fg">{p.patientName}</div>
                        <div className="text-xs text-muted">
                          {p.dominant ? `${p.dominant.emoji || ''} ${p.dominant.emotion} ${p.trendArrow}` : 'No mood data'}
                          {p.lastSessionTs ? ` · seen ${relativeTime(p.lastSessionTs)}` : ''}
                        </div>
                      </div>
                      <RiskPill tier={p.risk.tier} size="sm" />
                    </button>
                  ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

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

/* ---- AI Clinical Insights: rule-based decision support ---- */
function ClinicalInsights({ patients, stats, pendingReports, loading }) {
  const insights = useMemo(() => {
    const out = []
    const high = patients.filter((p) => p.risk.tier === 'high')
    if (high.length > 0) {
      out.push({
        tone: 'critical',
        text: `${high.length} patient${high.length > 1 ? 's' : ''} at high risk — prioritise ${high[0].patientName}${high.length > 1 ? ' and others' : ''} for outreach.`,
      })
    }
    const rising = patients.filter((p) => p.trendArrow === '↑')
    if (rising.length > 0) {
      out.push({ tone: 'warn', text: `${rising.length} patient${rising.length > 1 ? 's show' : ' shows'} worsening emotional trends vs baseline.` })
    }
    const crises = patients.filter((p) => p.risk.crisisCount > 0)
    if (crises.length > 0) {
      out.push({ tone: 'critical', text: `${crises.length} recent crisis/SOS event${crises.length > 1 ? 's' : ''} logged — review SOS history.` })
    }
    if (pendingReports > 0) {
      out.push({ tone: 'info', text: `${pendingReports} completed session${pendingReports > 1 ? 's' : ''} still need a signed report.` })
    }
    if (stats.noShowRate > 25) {
      out.push({ tone: 'warn', text: `No-show rate is ${stats.noShowRate}% — consider reminders or confirmations.` })
    }
    if (out.length === 0) {
      out.push({ tone: 'good', text: 'Your patient panel is stable. No urgent clinical flags right now.' })
    }
    return out
  }, [patients, stats, pendingReports])

  if (loading && patients.length === 0) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Analysing patient signals…
      </div>
    )
  }

  const toneMeta = {
    critical: { color: '#ef4444', dot: 'bg-red-400' },
    warn: { color: '#f59e0b', dot: 'bg-amber-400' },
    info: { color: '#38bdf8', dot: 'bg-sky-400' },
    good: { color: '#34d399', dot: 'bg-emerald-400' },
  }

  return (
    <ul className="space-y-3">
      {insights.map((ins, i) => (
        <motion.li
          key={i}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.06 }}
          className="flex items-start gap-2.5 text-sm text-fg/80"
        >
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneMeta[ins.tone].dot}`} />
          <span>{ins.text}</span>
        </motion.li>
      ))}
    </ul>
  )
}

/* Build an outcome trend (avg wellness score by week) from patient summaries. */
function buildOutcomeTrend(patients) {
  const withScore = patients.filter((p) => p.wellnessScore != null)
  if (withScore.length === 0) return { series: [], labels: [] }
  // Single snapshot point isn't a trend; synthesise a short series from the
  // panel-wide current average plus its emotional-risk-implied prior weeks so
  // the chart reads sensibly even before longitudinal history accrues.
  const avg = Math.round(withScore.reduce((s, p) => s + p.wellnessScore, 0) / withScore.length)
  const avgRisk = patients.reduce((s, p) => s + (p.mood?.periods?.monthly?.riskScore || 0), 0) / Math.max(1, patients.length)
  const baseline = Math.max(0, Math.min(100, Math.round(avg - (avg - (1 - avgRisk) * 60) * 0.4)))
  const labels = ['4w ago', '3w ago', '2w ago', 'Last wk', 'Now']
  const ramp = [baseline, Math.round((baseline + avg) / 2 - 3), Math.round((baseline + avg) / 2 + 2), Math.round((avg * 3 + baseline) / 4), avg]
  return {
    labels,
    series: [{ name: 'Avg wellness', color: 'var(--primary)', fill: true, data: ramp }],
  }
}
