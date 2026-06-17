import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LifeBuoy,
  Phone,
  Wind,
  Eye,
  Stethoscope,
  Users,
  Plus,
  Trash2,
  ArrowLeft,
  X,
  Play,
  Pause,
  CheckCircle2,
} from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import {
  HOTLINES,
  GROUNDING_STEPS,
  BREATHING_PHASES,
  CRISIS_EVENT_TYPES,
  logCrisisEvent,
  subscribeTrustedContacts,
  addTrustedContact,
  removeTrustedContact,
} from '../lib/sos.js'

export default function SOSPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const uid = profile?.uid

  const [tool, setTool] = useState(null) // 'breathing' | 'grounding'
  const [contacts, setContacts] = useState([])
  const [form, setForm] = useState({ name: '', phone: '', relationship: '' })
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState(null)

  // Log that the patient opened the SOS center (once per mount).
  useEffect(() => {
    if (uid) logCrisisEvent(uid, CRISIS_EVENT_TYPES.SOS_OPENED)
  }, [uid])

  useEffect(() => {
    if (!uid) return
    return subscribeTrustedContacts(uid, setContacts, () => {})
  }, [uid])

  const submitContact = async (e) => {
    e.preventDefault()
    setAdding(true)
    setNotice(null)
    try {
      await addTrustedContact(uid, form)
      setForm({ name: '', phone: '', relationship: '' })
      setNotice({ type: 'ok', text: 'Trusted contact added.' })
    } catch (err) {
      setNotice({ type: 'err', text: err.message })
    } finally {
      setAdding(false)
    }
  }

  return (
    <PageTransition className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <button
        onClick={() => navigate('/dashboard/patient')}
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-accent transition hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </button>

      {/* Header */}
      <header className="mb-8 rounded-2xl border border-danger/40 bg-danger-soft p-6">
        <h1 className="flex items-center gap-2 text-3xl font-bold text-fg">
          <LifeBuoy className="h-8 w-8 text-danger" /> Crisis &amp; SOS Center
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          You are not alone. If you are in immediate danger, call your local emergency number now.
          Below are crisis lines, quick calming tools, a shortcut to book a doctor, and your
          trusted contacts.
        </p>
      </header>

      {notice && (
        <div
          className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
            notice.type === 'ok'
              ? 'border-success/40 bg-success-soft text-success'
              : 'border-danger/40 bg-danger-soft text-danger'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Emergency resources */}
      <section className="card mb-6 border-danger/40 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-danger">
          <Phone className="h-5 w-5" /> Emergency Resources
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {HOTLINES.map((h) => {
            const isUrl = h.phone.startsWith('http')
            const href = isUrl ? h.phone : `tel:${h.phone.replace(/[^0-9]/g, '')}`
            return (
              <a
                key={h.name}
                href={href}
                target={isUrl ? '_blank' : undefined}
                rel={isUrl ? 'noopener noreferrer' : undefined}
                className="flex items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger-soft p-4 transition hover:border-danger hover:bg-danger hover:text-danger-fg"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-fg">{h.name}</div>
                  <div className="truncate text-sm text-danger">{h.phone}</div>
                </div>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-muted">
                  {h.region}
                </span>
              </a>
            )
          })}
        </div>
      </section>

      {/* Calming tools + doctor shortcut */}
      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <button
          onClick={() => setTool('breathing')}
          className="card flex flex-col items-start gap-2 p-5 text-left transition hover:border-primary"
        >
          <Wind className="h-7 w-7 text-primary" />
          <h3 className="font-bold text-fg">Breathing Exercise</h3>
          <p className="text-xs text-muted">Box breathing to calm your nervous system in a minute.</p>
        </button>
        <button
          onClick={() => setTool('grounding')}
          className="card flex flex-col items-start gap-2 p-5 text-left transition hover:border-success"
        >
          <Eye className="h-7 w-7 text-success" />
          <h3 className="font-bold text-fg">Grounding Exercise</h3>
          <p className="text-xs text-muted">The 5-4-3-2-1 senses technique to anchor you in the present.</p>
        </button>
        <button
          onClick={() => navigate('/consult-doc')}
          className="card flex flex-col items-start gap-2 p-5 text-left transition hover:border-accent"
        >
          <Stethoscope className="h-7 w-7 text-accent" />
          <h3 className="font-bold text-fg">Talk to a Doctor</h3>
          <p className="text-xs text-muted">Book a secure consultation with a certified doctor.</p>
        </button>
      </section>

      {/* Trusted contacts */}
      <section className="card p-6">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-accent">
          <Users className="h-5 w-5" /> Trusted Contacts
        </h2>
        <p className="mb-4 text-sm text-muted">
          People you can reach out to quickly. Only you can see this list.
        </p>

        <div className="mb-5 space-y-2">
          {contacts.length === 0 ? (
            <p className="text-sm text-faint">No trusted contacts yet. Add someone you trust below.</p>
          ) : (
            contacts.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3.5"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-fg">
                    {c.name}
                    {c.relationship && (
                      <span className="ml-2 text-xs font-normal text-faint">{c.relationship}</span>
                    )}
                  </div>
                  <div className="truncate text-sm text-muted">{c.phone}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <a
                    href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`}
                    onClick={() => logCrisisEvent(uid, CRISIS_EVENT_TYPES.CONTACT_USED, c.relationship)}
                    className="inline-flex items-center gap-1 rounded-lg bg-success-soft px-3 py-1.5 text-xs font-semibold text-success transition hover:bg-success hover:text-primary-fg"
                  >
                    <Phone className="h-3.5 w-3.5" /> Call
                  </a>
                  <a
                    href={`sms:${c.phone.replace(/[^0-9+]/g, '')}`}
                    onClick={() => logCrisisEvent(uid, CRISIS_EVENT_TYPES.CONTACT_USED, c.relationship)}
                    className="inline-flex items-center gap-1 rounded-lg bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary hover:text-primary-fg"
                  >
                    💬 Text
                  </a>
                  <button
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to remove ${c.name} from your trusted contacts?`)) {
                        removeTrustedContact(c.id)
                      }
                    }}
                    className="rounded-lg p-1.5 text-faint transition hover:text-danger"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={submitContact} className="grid gap-3 sm:grid-cols-4">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name"
            required
            maxLength={100}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Phone number"
            required
            pattern="[+]?[0-9\s-]{6,20}"
            title="Please enter a valid phone number (minimum 6 digits)"
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <input
            value={form.relationship}
            onChange={(e) => setForm({ ...form, relationship: e.target.value })}
            placeholder="Relationship (optional)"
            maxLength={60}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            disabled={adding}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
      </section>

      <AnimatePresence>
        {tool === 'breathing' && (
          <BreathingModal uid={uid} onClose={() => setTool(null)} />
        )}
        {tool === 'grounding' && (
          <GroundingModal uid={uid} onClose={() => setTool(null)} />
        )}
      </AnimatePresence>
    </PageTransition>
  )
}

// ---------------------------------------------------------------------------
// Breathing exercise modal (box breathing 4-4-4-4)
// ---------------------------------------------------------------------------
function BreathingModal({ uid, onClose }) {
  const [running, setRunning] = useState(true)
  const [phaseIdx, setPhaseIdx] = useState(0)
  const [seconds, setSeconds] = useState(BREATHING_PHASES[0].seconds)
  const [cycles, setCycles] = useState(0)
  const loggedRef = useRef(false)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s > 1) return s - 1
        const next = (phaseIdx + 1) % BREATHING_PHASES.length
        setPhaseIdx(next)
        if (next === 0) setCycles((c) => c + 1)
        return BREATHING_PHASES[next].seconds
      })
    }, 1000)
    return () => clearInterval(id)
  }, [running, phaseIdx])

  useEffect(() => {
    if (cycles >= 3 && !loggedRef.current) {
      loggedRef.current = true
      logCrisisEvent(uid, CRISIS_EVENT_TYPES.BREATHING, `${cycles} cycles`)
    }
  }, [cycles, uid])

  const phase = BREATHING_PHASES[phaseIdx]

  return (
    <Modal onClose={onClose} title="Box Breathing" accent="var(--color-primary)" icon={Wind}>
      <div className="flex flex-col items-center gap-6 py-4">
        <motion.div
          animate={{
            scale: phase.label === 'Breathe In' ? 1.25 : phase.label === 'Breathe Out' ? 0.85 : 1.05,
          }}
          transition={{ duration: phase.seconds, ease: 'easeInOut' }}
          className="flex h-40 w-40 items-center justify-center rounded-full border-4 border-primary/40 bg-primary-soft"
        >
          <div className="text-center">
            <div className="text-lg font-bold text-primary">{phase.label}</div>
            <div className="text-3xl font-bold tabular-nums text-fg">{seconds}</div>
          </div>
        </motion.div>
        <p className="text-sm text-muted">Cycles completed: <span className="font-bold text-fg">{cycles}</span></p>
        <div className="flex gap-3">
          <button
            onClick={() => setRunning((r) => !r)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:bg-surface-2"
          >
            {running ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Resume</>}
          </button>
        </div>
        <p className="text-center text-xs text-faint">
          Breathe in for 4, hold for 4, out for 4, hold for 4. Aim for 3+ cycles.
        </p>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Grounding exercise modal (5-4-3-2-1)
// ---------------------------------------------------------------------------
function GroundingModal({ uid, onClose }) {
  const [step, setStep] = useState(0)
  const done = step >= GROUNDING_STEPS.length

  useEffect(() => {
    if (done) logCrisisEvent(uid, CRISIS_EVENT_TYPES.GROUNDING)
  }, [done, uid])

  return (
    <Modal onClose={onClose} title="5-4-3-2-1 Grounding" accent="var(--color-success)" icon={Eye}>
      {done ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-success" />
          <h3 className="text-lg font-bold text-fg">Well done.</h3>
          <p className="max-w-sm text-sm text-muted">
            You moved your focus back to the present. Notice how your body feels now — a little
            steadier, perhaps. You can repeat this anytime.
          </p>
          <button
            onClick={onClose}
            className="mt-2 rounded-lg bg-success px-5 py-2 text-sm font-bold text-primary-fg transition hover:opacity-90"
          >
            Finish
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 py-4 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-success">
            Step {step + 1} of {GROUNDING_STEPS.length}
          </div>
          <h3 className="text-2xl font-bold text-fg">{GROUNDING_STEPS[step].sense}</h3>
          <p className="max-w-sm text-sm text-muted">{GROUNDING_STEPS[step].detail}</p>
          <div className="mt-2 flex w-full justify-center gap-1.5">
            {GROUNDING_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-success' : 'bg-surface-2'}`}
              />
            ))}
          </div>
          <button
            onClick={() => setStep((s) => s + 1)}
            className="mt-2 rounded-lg bg-success px-6 py-2.5 text-sm font-bold text-primary-fg transition hover:opacity-90"
          >
            {step === GROUNDING_STEPS.length - 1 ? 'Complete' : 'Next'}
          </button>
        </div>
      )}
    </Modal>
  )
}

function Modal({ title, accent, icon: Icon, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="card w-full max-w-md overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-bold" style={{ color: accent }}>
            <Icon className="h-5 w-5" /> {title}
          </h3>
          <button onClick={onClose} className="text-muted transition hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5">{children}</div>
      </motion.div>
    </div>
  )
}
