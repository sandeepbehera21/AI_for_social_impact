import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CalendarDays,
  CalendarCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Video,
  Check,
  X,
  CalendarClock,
  Loader2,
  TrendingUp,
  UserX,
  Percent,
  FileSignature,
} from 'lucide-react'
import DoctorLayout from '../components/DoctorLayout.jsx'
import { KpiCard, RiskPill, EmptyState } from '../components/DoctorPrimitives.jsx'
import CompleteSessionModal from '../components/CompleteSessionModal.jsx'
import CountdownJoinButton from '../components/CountdownJoinButton.jsx'
import { useDoctorPatients } from '../hooks/useDoctorPatients.js'
import {
  setAppointmentStatus,
  rescheduleAppointment,
  APPT_STATUS,
} from '../lib/appointments.js'
import { notifyNextInWaitlist } from '../lib/waitlist.js'
import { toTs } from '../lib/doctorData.js'
import { formatDateTime, todayISODate, dayTimeSlots, combineDateTime } from '../lib/datetime.js'

const FILTERS = [
  { key: 'upcoming', label: 'Upcoming', icon: CalendarCheck },
  { key: 'pending', label: 'Pending Approval', icon: Clock },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
  { key: 'cancelled', label: 'Cancelled', icon: XCircle },
]

export default function AppointmentsPage() {
  const navigate = useNavigate()
  const { appointments, patients, stats, nowTs } = useDoctorPatients()
  const [filter, setFilter] = useState('upcoming')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [reschedule, setReschedule] = useState(null)
  const [signing, setSigning] = useState(null)

  const riskOf = (patientId) => patients.find((p) => p.patientId === patientId)?.risk

  const buckets = useMemo(() => {
    const now = nowTs
    return {
      upcoming: appointments
        .filter(
          (a) =>
            a.status === 'active' ||
            (a.status === APPT_STATUS.APPROVED && toTs(a.dateTime) + 15 * 60 * 1000 >= now),
        )
        .sort((a, b) => toTs(a.dateTime) - toTs(b.dateTime)),
      pending: appointments
        .filter((a) => a.status === APPT_STATUS.PENDING)
        .sort((a, b) => toTs(a.dateTime) - toTs(b.dateTime)),
      completed: appointments
        .filter((a) => a.status === APPT_STATUS.COMPLETED)
        .sort((a, b) => toTs(b.dateTime) - toTs(a.dateTime)),
      cancelled: appointments
        .filter(
          (a) =>
            a.status === APPT_STATUS.REJECTED ||
            a.status === 'expired' ||
            (a.status === APPT_STATUS.APPROVED && toTs(a.dateTime) + 15 * 60 * 1000 < now),
        )
        .sort((a, b) => toTs(b.dateTime) - toTs(a.dateTime)),
    }
  }, [appointments, nowTs])

  const rows = buckets[filter] || []

  const act = async (id, status) => {
    setBusyId(id)
    setError('')
    try {
      const appt = appointments.find((a) => a.id === id)
      await setAppointmentStatus(id, status)
      if (status === APPT_STATUS.REJECTED && appt) {
        await notifyNextInWaitlist(appt.doctorId, appt.dateTime)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const doReschedule = async (id, dt) => {
    setBusyId(id)
    setError('')
    try {
      const appt = appointments.find((a) => a.id === id)
      const oldDateTime = appt?.dateTime
      const doctorId = appt?.doctorId
      
      await rescheduleAppointment(id, dt)
      setReschedule(null)
      
      if (oldDateTime && doctorId) {
        await notifyNextInWaitlist(doctorId, oldDateTime)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <DoctorLayout title="Appointments" subtitle="Manage requests, sessions, and your consultation schedule.">
      {error && (
        <div className="mb-5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={CalendarDays} label="Today's Appointments" value={stats.today} accent="#00ffd5" delay={0} />
        <KpiCard icon={TrendingUp} label="This Week" value={stats.week} accent="#38bdf8" delay={0.05} />
        <KpiCard icon={Percent} label="Completion Rate" value={`${stats.completionRate}%`} accent="#34d399" sub={`${stats.completed} completed`} delay={0.1} />
        <KpiCard icon={UserX} label="No-show Rate" value={`${stats.noShowRate}%`} accent="#f59e0b" sub={`${stats.noShows} no-shows`} delay={0.15} />
      </div>

      {/* Filter tabs */}
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
              filter === f.key
                ? 'bg-primary text-primary-fg'
                : 'border border-border text-muted hover:bg-surface-2'
            }`}
          >
            <f.icon className="h-4 w-4" /> {f.label}
            <span className={`rounded-full px-1.5 text-xs ${filter === f.key ? 'bg-primary-fg/15 text-primary-fg' : 'bg-surface-2 text-muted'}`}>
              {buckets[f.key].length}
            </span>
          </button>
        ))}
      </div>

      {/* Appointment list */}
      {rows.length === 0 ? (
        <EmptyState icon={CalendarDays} title={`No ${filter} appointments`} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {/* Header (desktop) */}
          <div className="hidden grid-cols-12 gap-3 border-b border-border bg-surface-2 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted sm:grid">
            <div className="col-span-3">Patient</div>
            <div className="col-span-3">Date &amp; Time</div>
            <div className="col-span-2">Risk</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-3 text-right">Actions</div>
          </div>
          {rows.map((a, i) => {
            const risk = riskOf(a.patientId)
            const isPastApproved = filter === 'cancelled' && a.status === APPT_STATUS.APPROVED
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="grid grid-cols-1 gap-3 border-b border-border px-4 py-4 last:border-0 sm:grid-cols-12 sm:items-center bg-surface hover:bg-surface-2/40 transition-colors"
              >
                <div className="col-span-3 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary border border-primary/10">
                    {(a.patientName || 'P').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="font-medium text-fg">{a.patientName}</span>
                </div>
                <div className="col-span-3 text-sm text-muted">{formatDateTime(a.dateTime)}</div>
                <div className="col-span-2">{risk ? <RiskPill tier={risk.tier} size="sm" /> : <span className="text-xs text-faint">—</span>}</div>
                <div className="col-span-1">
                  <StatusChip status={isPastApproved ? 'no-show' : a.status} />
                </div>
                <div className="col-span-3 flex flex-wrap justify-end gap-2">
                  {filter === 'pending' && (
                    <>
                      <IconBtn icon={busyId === a.id ? Loader2 : Check} label="Approve" accent spin={busyId === a.id} onClick={() => act(a.id, APPT_STATUS.APPROVED)} />
                      <IconBtn icon={X} label="Reject" danger onClick={() => act(a.id, APPT_STATUS.REJECTED)} />
                    </>
                  )}
                  {filter === 'upcoming' && (
                    <>
                      <CountdownJoinButton appointment={a} isDoctor={true} onJoin={() => navigate(`/consultation/${a.id}`)} />
                      <IconBtn icon={CalendarClock} label="Reschedule" onClick={() => setReschedule(a)} />
                      <IconBtn icon={FileSignature} label="Sign" onClick={() => setSigning(a)} />
                    </>
                  )}
                  {filter === 'cancelled' && isPastApproved && (
                    <IconBtn icon={CalendarClock} label="Reschedule" onClick={() => setReschedule(a)} />
                  )}
                  {filter === 'completed' && (
                    a.signature ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success border border-success/10">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Signed
                      </span>
                    ) : (
                      <IconBtn icon={FileSignature} label="Sign report" onClick={() => setSigning(a)} />
                    )
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Reschedule modal */}
      <AnimatePresence>
        {reschedule && (
          <RescheduleModal
            appointment={reschedule}
            busy={busyId === reschedule.id}
            onClose={() => setReschedule(null)}
            onConfirm={(dt) => doReschedule(reschedule.id, dt)}
          />
        )}
      </AnimatePresence>

      {signing && (
        <CompleteSessionModal appointment={signing} onClose={() => setSigning(null)} onCompleted={() => setSigning(null)} />
      )}
    </DoctorLayout>
  )
}

function StatusChip({ status }) {
  const meta = {
    pending: { label: 'Pending', cls: 'bg-warning-soft text-warning' },
    approved: { label: 'Approved', cls: 'bg-primary-soft text-primary' },
    completed: { label: 'Completed', cls: 'bg-success-soft text-success' },
    rejected: { label: 'Rejected', cls: 'bg-danger-soft text-danger' },
    expired: { label: 'Expired', cls: 'bg-surface-2 text-muted border border-border' },
    'no-show': { label: 'No-show', cls: 'bg-warning-soft text-warning border border-warning/10' },
  }[status] || { label: status, cls: 'bg-surface-2 text-muted' }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function IconBtn({ icon: Icon, label, onClick, accent, danger, spin }) {
  const cls = accent
    ? 'bg-primary text-primary-fg hover:bg-primary-hover'
    : danger
    ? 'border border-danger/40 text-danger hover:bg-danger-soft'
    : 'border border-border text-muted hover:bg-surface-2'
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${cls}`}>
      <Icon className={`h-3.5 w-3.5 ${spin ? 'animate-spin' : ''}`} /> {label}
    </button>
  )
}

/* ---- Reschedule modal ---- */
function RescheduleModal({ appointment, busy, onClose, onConfirm }) {
  const [date, setDate] = useState(todayISODate())
  const [time, setTime] = useState('09:00')
  const slots = dayTimeSlots()

  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="card fixed left-1/2 top-1/2 z-50 w-[92%] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 bg-surface border-border shadow-lg"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold text-fg">
            <CalendarClock className="h-5 w-5 text-primary" /> Reschedule
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-2 transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-sm text-muted">
          Moving <span className="font-semibold text-fg">{appointment.patientName}</span>'s session, currently {formatDateTime(appointment.dateTime)}.
        </p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">New date</span>
            <input type="date" min={todayISODate()} value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-fg focus:border-primary focus:outline-none" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">New time</span>
            <select value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-fg focus:border-primary focus:outline-none">
              {slots.map((s) => (
                <option key={s} value={s} className="bg-surface text-fg">{s}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted hover:bg-surface-2 transition-colors">Cancel</button>
          <button
            onClick={() => onConfirm(combineDateTime(date, time))}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm
          </button>
        </div>
      </motion.div>
    </>
  )
}
