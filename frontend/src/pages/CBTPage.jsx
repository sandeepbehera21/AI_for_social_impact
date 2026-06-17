import { useEffect, useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  BrainCircuit,
  ArrowLeft,
  Loader2,
  Calendar,
  Trash2,
  CheckCircle2,
  BookOpen,
  Sparkles,
  Heart,
  Smile,
  ShieldCheck,
} from 'lucide-react'
import { db } from '../lib/firebase.js'
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { useAuth } from '../context/AuthContext.jsx'
import PageTransition from '../components/PageTransition.jsx'
import { sanitizeInput } from '../lib/sanitize.js'

const CBT_TYPES = {
  reframing: {
    title: 'Thought Reframing',
    desc: 'Identify cognitive distortions and reframe negative thoughts.',
    icon: BrainCircuit,
    color: '#a78bfa',
  },
  anxiety: {
    title: 'Anxiety Worksheet',
    desc: 'Map physical sensations and triggers, and build a coping plan.',
    icon: Sparkles,
    color: '#3b82f6',
  },
  stress: {
    title: 'Stress Worksheet',
    desc: 'Separate what you can control from what you cannot.',
    icon: ShieldCheck,
    color: '#f97316',
  },
  gratitude: {
    title: 'Gratitude Exercise',
    desc: 'Refocus your mind on positive events and appreciation.',
    icon: Heart,
    color: '#22c55e',
  },
  reflection: {
    title: 'Self-Reflection',
    desc: 'Reflect on daily growth and emotional achievements.',
    icon: BookOpen,
    color: '#ec4899',
  },
}

const DISTORTIONS = [
  { id: 'catastrophizing', label: 'Catastrophizing (Expecting the absolute worst)' },
  { id: 'all_or_nothing', label: 'All-or-Nothing (Black-and-white thinking)' },
  { id: 'mind_reading', label: 'Mind Reading (Assuming you know what others think)' },
  { id: 'emotional_reasoning', label: 'Emotional Reasoning (I feel it, so it must be true)' },
  { id: 'overgeneralization', label: 'Overgeneralization (A single negative event is a pattern)' },
  { id: 'shoulds', label: 'Should Statements (Guilting yourself with strict rules)' },
]

export default function CBTPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Auto-open specific sheet if redirected from dashboard smart recommendations
  useEffect(() => {
    if (location.state?.autoOpen && CBT_TYPES[location.state.autoOpen]) {
      setActiveType(location.state.autoOpen)
    }
  }, [location.state])

  // ── State ─────────────────────────────────────────────────────────────────
  const [exercises, setExercises] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeType, setActiveType] = useState(null) // selected exercise sheet to fill
  const [viewingPast, setViewingPast] = useState(null) // past exercise being viewed

  // Form Fields for Worksheets
  const [reframingForm, setReframingForm] = useState({
    ant: '',
    distortions: [],
    evidenceFor: '',
    evidenceAgainst: '',
    balancedThought: '',
  })

  const [anxietyForm, setAnxietyForm] = useState({
    trigger: '',
    sensations: '',
    worstCase: '',
    copingPlan: '',
  })

  const [stressForm, setStressForm] = useState({
    stressor: '',
    inControl: '',
    outControl: '',
    actions: '',
  })

  const [gratitudeForm, setGratitudeForm] = useState({
    item1: '', reason1: '',
    item2: '', reason2: '',
    item3: '', reason3: '',
  })

  const [reflectionForm, setReflectionForm] = useState({
    wentWell: '',
    challenge: '',
    proudOf: '',
  })

  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  // ── Load Past Exercises ───────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.uid) return
    const q = query(
      collection(db, 'cbt_exercises'),
      where('patientId', '==', profile.uid)
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        list.sort((a, b) => (b.ts || 0) - (a.ts || 0))
        setExercises(list)
        setLoading(false)
      },
      (err) => {
        console.error('CBT subscription error:', err)
        setLoading(false)
      }
    )
    return unsub
  }, [profile?.uid])

  // ── Save Exercise ─────────────────────────────────────────────────────────
  const save = async (type, formData) => {
    setSaving(true)
    setNotice(null)
    try {
      const cleanData = {}
      for (const [key, val] of Object.entries(formData)) {
        if (typeof val === 'string') {
          cleanData[key] = sanitizeInput(val)
        } else if (Array.isArray(val)) {
          cleanData[key] = val.map(item => typeof item === 'string' ? sanitizeInput(item) : item)
        } else {
          cleanData[key] = val
        }
      }

      await addDoc(collection(db, 'cbt_exercises'), {
        patientId: profile.uid,
        type,
        data: cleanData,
        ts: Date.now(),
        createdAt: serverTimestamp(),
      })
      setNotice({ type: 'ok', text: 'Worksheet saved successfully.' })
      // Clear forms
      resetForms()
      setActiveType(null)
    } catch (err) {
      setNotice({ type: 'err', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const resetForms = () => {
    setReframingForm({ ant: '', distortions: [], evidenceFor: '', evidenceAgainst: '', balancedThought: '' })
    setAnxietyForm({ trigger: '', sensations: '', worstCase: '', copingPlan: '' })
    setStressForm({ stressor: '', inControl: '', outControl: '', actions: '' })
    setGratitudeForm({ item1: '', reason1: '', item2: '', reason2: '', item3: '', reason3: '' })
    setReflectionForm({ wentWell: '', challenge: '', proudOf: '' })
  }

  // ── Delete Exercise ───────────────────────────────────────────────────────
  const remove = async (id, e) => {
    e.stopPropagation()
    if (!window.confirm('Delete this worksheet history?')) return
    try {
      await deleteDoc(doc(db, 'cbt_exercises', id))
      if (viewingPast?.id === id) setViewingPast(null)
      setNotice({ type: 'ok', text: 'Worksheet history deleted.' })
    } catch (err) {
      setNotice({ type: 'err', text: err.message })
    }
  }

  // Distortion helper checkbox toggle
  const toggleDistortion = (id) => {
    setReframingForm((prev) => {
      const active = prev.distortions.includes(id)
      const list = active
        ? prev.distortions.filter((d) => d !== id)
        : [...prev.distortions, id]
      return { ...prev, distortions: list }
    })
  }

  return (
    <PageTransition className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* Back Header */}
      <div className="mb-6">
        <button
          onClick={() => {
            if (activeType || viewingPast) {
              setActiveType(null)
              setViewingPast(null)
              setNotice(null)
            } else {
              navigate('/dashboard/patient')
            }
          }}
          className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition hover:text-accent"
        >
          <ArrowLeft className="h-4 w-4" />{' '}
          {activeType || viewingPast ? 'Back to CBT Overview' : 'Back to Dashboard'}
        </button>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-accent">CBT Exercises</h1>
        <p className="mt-1 text-sm text-muted">
          Cognitive Behavioral Therapy (CBT) tools to reframe negative thoughts, manage anxiety, and cultivate gratitude.
        </p>
      </header>

      {notice && (
        <div
          className={`mb-6 rounded-lg border px-3 py-2 text-xs ${
            notice.type === 'ok'
              ? 'border-accent/40 bg-accent-soft text-accent'
              : 'border-danger/40 bg-danger-soft text-danger'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* ── Case 1: Filling an Exercise ── */}
      {activeType && (
        <section className="card p-6">
          <h2 className="mb-4 text-xl font-bold text-fg flex items-center gap-2">
            {(() => {
              const Icon = CBT_TYPES[activeType].icon
              return <Icon className="h-6 w-6" style={{ color: CBT_TYPES[activeType].color }} />
            })()}
            {CBT_TYPES[activeType].title}
          </h2>
          <p className="mb-6 text-sm text-muted">{CBT_TYPES[activeType].desc}</p>

          {/* Form rendering based on type */}
          {activeType === 'reframing' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  1. Automatic Negative Thought (ANT)
                </label>
                <input
                  type="text"
                  placeholder="e.g. I am going to fail this exam and my parents will be ashamed of me."
                  value={reframingForm.ant}
                  onChange={(e) => setReframingForm({ ...reframingForm, ant: e.target.value })}
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  2. Identify Cognitive Distortions
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {DISTORTIONS.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 p-2.5 text-xs text-muted hover:border-border-strong cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={reframingForm.distortions.includes(d.id)}
                        onChange={() => toggleDistortion(d.id)}
                        className="mt-0.5 rounded border-border text-primary focus:ring-0"
                      />
                      <span>{d.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted">
                    3. Evidence FOR the Thought
                  </label>
                  <textarea
                    placeholder="What facts support this thought?"
                    value={reframingForm.evidenceFor}
                    onChange={(e) => setReframingForm({ ...reframingForm, evidenceFor: e.target.value })}
                    className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted">
                    4. Evidence AGAINST the Thought
                  </label>
                  <textarea
                    placeholder="What facts contradict this thought?"
                    value={reframingForm.evidenceAgainst}
                    onChange={(e) => setReframingForm({ ...reframingForm, evidenceAgainst: e.target.value })}
                    className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  5. Balanced Alternative Thought
                </label>
                <textarea
                  placeholder="e.g. Even if the exam is tough, I have prepared. Failing a test does not mean my entire career is ruined or my parents will stop loving me."
                  value={reframingForm.balancedThought}
                  onChange={(e) => setReframingForm({ ...reframingForm, balancedThought: e.target.value })}
                  className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              <button
                onClick={() => save('reframing', reframingForm)}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Complete thought reframing'}
              </button>
            </div>
          )}

          {activeType === 'anxiety' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  1. Trigger
                </label>
                <input
                  type="text"
                  placeholder="What triggered your anxiety? e.g. Preparing for placements, upcoming interviews."
                  value={anxietyForm.trigger}
                  onChange={(e) => setAnxietyForm({ ...anxietyForm, trigger: e.target.value })}
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  2. Physical Sensations
                </label>
                <input
                  type="text"
                  placeholder="How does it feel in your body? e.g. Rapid heartbeat, sweating, muscle tension."
                  value={anxietyForm.sensations}
                  onChange={(e) => setAnxietyForm({ ...anxietyForm, sensations: e.target.value })}
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  3. Worst-case scenario
                </label>
                <textarea
                  placeholder="What is the worst-case scenario you are imagining?"
                  value={anxietyForm.worstCase}
                  onChange={(e) => setAnxietyForm({ ...anxietyForm, worstCase: e.target.value })}
                  className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  4. Coping Strategy &amp; Grounding Actions
                </label>
                <textarea
                  placeholder="What actions can you take? e.g. 5-min guided box breathing, calling a trusted friend, writing down facts."
                  value={anxietyForm.copingPlan}
                  onChange={(e) => setAnxietyForm({ ...anxietyForm, copingPlan: e.target.value })}
                  className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              <button
                onClick={() => save('anxiety', anxietyForm)}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save anxiety worksheet'}
              </button>
            </div>
          )}

          {activeType === 'stress' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  1. Stressor
                </label>
                <input
                  type="text"
                  placeholder="What is causing you stress? e.g. Piling assignments, heavy workload."
                  value={stressForm.stressor}
                  onChange={(e) => setStressForm({ ...stressForm, stressor: e.target.value })}
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted">
                    2. Within My Control
                  </label>
                  <textarea
                    placeholder="What part of this can you directly control?"
                    value={stressForm.inControl}
                    onChange={(e) => setStressForm({ ...stressForm, inControl: e.target.value })}
                    className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted">
                    3. Outside My Control
                  </label>
                  <textarea
                    placeholder="What part of this is outside your control? How can you let it go?"
                    value={stressForm.outControl}
                    onChange={(e) => setStressForm({ ...stressForm, outControl: e.target.value })}
                    className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  4. Two Concrete Action Steps Today
                </label>
                <textarea
                  placeholder="e.g. 1) Finish 1 page of assignment, 2) Send boss email about workload limits."
                  value={stressForm.actions}
                  onChange={(e) => setStressForm({ ...stressForm, actions: e.target.value })}
                  className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              <button
                onClick={() => save('stress', stressForm)}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save stress worksheet'}
              </button>
            </div>
          )}

          {activeType === 'gratitude' && (
            <div className="space-y-4">
              <p className="text-xs text-muted mb-2">Write down three things you are grateful for today, and the reason why.</p>
              {[1, 2, 3].map((idx) => (
                <div key={idx} className="grid gap-3 sm:grid-cols-2 border-b border-border pb-4 last:border-0 last:pb-0">
                  <div>
                    <label className="mb-1 block text-xs text-muted">Gratitude Item #{idx}</label>
                    <input
                      type="text"
                      placeholder="e.g. A nice cup of coffee, a call from a friend."
                      value={gratitudeForm[`item${idx}`]}
                      onChange={(e) => setGratitudeForm({ ...gratitudeForm, [`item${idx}`]: e.target.value })}
                      className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-xs text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted">Why you appreciate it</label>
                    <input
                      type="text"
                      placeholder="e.g. It helped me feel relaxed and connected."
                      value={gratitudeForm[`reason${idx}`]}
                      onChange={(e) => setGratitudeForm({ ...gratitudeForm, [`reason${idx}`]: e.target.value })}
                      className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-xs text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
              ))}

              <button
                onClick={() => save('gratitude', gratitudeForm)}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log daily gratitude'}
              </button>
            </div>
          )}

          {activeType === 'reflection' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  1. What went well today?
                </label>
                <textarea
                  placeholder="Reflect on positive events or successful moments."
                  value={reflectionForm.wentWell}
                  onChange={(e) => setReflectionForm({ ...reflectionForm, wentWell: e.target.value })}
                  className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  2. What was the biggest challenge, and how did you handle it?
                </label>
                <textarea
                  placeholder="Describe how you managed tough feelings or situations."
                  value={reflectionForm.challenge}
                  onChange={(e) => setReflectionForm({ ...reflectionForm, challenge: e.target.value })}
                  className="w-full h-24 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  3. What is one thing you are proud of yourself for today?
                </label>
                <input
                  type="text"
                  placeholder="Acknowledge your efforts and celebrate a small win."
                  value={reflectionForm.proudOf}
                  onChange={(e) => setReflectionForm({ ...reflectionForm, proudOf: e.target.value })}
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <button
                onClick={() => save('reflection', reflectionForm)}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save self-reflection'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Case 2: Viewing a Past Exercise ── */}
      {viewingPast && (
        <section className="card p-6">
          <h2 className="mb-2 text-xl font-bold text-fg flex items-center justify-between">
            <span className="flex items-center gap-2">
              {(() => {
                const Icon = CBT_TYPES[viewingPast.type].icon
                return <Icon className="h-6 w-6" style={{ color: CBT_TYPES[viewingPast.type].color }} />
              })()}
              {CBT_TYPES[viewingPast.type].title}
            </span>
            <button
              onClick={(e) => remove(viewingPast.id, e)}
              className="text-muted hover:text-danger p-1.5 transition"
              title="Delete reflection history"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </h2>
          <div className="mb-6 flex items-center gap-2 text-xs text-muted">
            <Calendar className="h-3.5 w-3.5" /> Checked in on:{' '}
            {viewingPast.ts ? new Date(viewingPast.ts).toLocaleString() : '—'}
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4 text-sm leading-relaxed">
            {viewingPast.type === 'reframing' && (
              <>
                <div>
                  <div className="font-bold text-muted mb-0.5">Automatic Negative Thought:</div>
                  <div className="text-fg">{viewingPast.data?.ant || '—'}</div>
                </div>
                <div>
                  <div className="font-bold text-muted mb-0.5">Cognitive Distortions:</div>
                  <div className="text-accent font-semibold">
                    {viewingPast.data?.distortions?.map((d) => d.replace('_', ' ')).join(', ') || 'None selected'}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="font-bold text-muted mb-0.5">Evidence For:</div>
                    <div className="text-fg whitespace-pre-wrap">{viewingPast.data?.evidenceFor || '—'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-muted mb-0.5">Evidence Against:</div>
                    <div className="text-fg whitespace-pre-wrap">{viewingPast.data?.evidenceAgainst || '—'}</div>
                  </div>
                </div>
                <div>
                  <div className="font-bold text-success mb-0.5">Reframed Balanced Thought:</div>
                  <div className="text-success font-semibold whitespace-pre-wrap">{viewingPast.data?.balancedThought || '—'}</div>
                </div>
              </>
            )}

            {viewingPast.type === 'anxiety' && (
              <>
                <div>
                  <div className="font-bold text-muted mb-0.5">Trigger:</div>
                  <div className="text-fg">{viewingPast.data?.trigger || '—'}</div>
                </div>
                <div>
                  <div className="font-bold text-muted mb-0.5">Physical Sensations:</div>
                  <div className="text-fg">{viewingPast.data?.sensations || '—'}</div>
                </div>
                <div>
                  <div className="font-bold text-muted mb-0.5">Worst-case scenario:</div>
                  <div className="text-fg whitespace-pre-wrap">{viewingPast.data?.worstCase || '—'}</div>
                </div>
                <div>
                  <div className="font-bold text-primary mb-0.5">Coping Plan:</div>
                  <div className="text-primary font-semibold whitespace-pre-wrap">{viewingPast.data?.copingPlan || '—'}</div>
                </div>
              </>
            )}

            {viewingPast.type === 'stress' && (
              <>
                <div>
                  <div className="font-bold text-muted mb-0.5">Stressor:</div>
                  <div className="text-fg">{viewingPast.data?.stressor || '—'}</div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="font-bold text-muted mb-0.5">Within Control:</div>
                    <div className="text-fg whitespace-pre-wrap">{viewingPast.data?.inControl || '—'}</div>
                  </div>
                  <div>
                    <div className="font-bold text-muted mb-0.5">Outside Control:</div>
                    <div className="text-fg whitespace-pre-wrap">{viewingPast.data?.outControl || '—'}</div>
                  </div>
                </div>
                <div>
                  <div className="font-bold text-warning mb-0.5">Action Plan:</div>
                  <div className="text-warning font-semibold whitespace-pre-wrap">{viewingPast.data?.actions || '—'}</div>
                </div>
              </>
            )}

            {viewingPast.type === 'gratitude' && (
              <div className="space-y-3">
                {[1, 2, 3].map((idx) => (
                  <div key={idx} className="border-b border-border pb-2 last:border-0 last:pb-0">
                    <div className="font-semibold text-success">
                      Item #{idx}: {viewingPast.data?.[`item${idx}`] || '—'}
                    </div>
                    <div className="text-xs text-muted italic mt-0.5">
                      Why: {viewingPast.data?.[`reason${idx}`] || '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {viewingPast.type === 'reflection' && (
              <>
                <div>
                  <div className="font-bold text-muted mb-0.5">What went well today?</div>
                  <div className="text-fg whitespace-pre-wrap">{viewingPast.data?.wentWell || '—'}</div>
                </div>
                <div>
                  <div className="font-bold text-muted mb-0.5">Biggest Challenge:</div>
                  <div className="text-fg whitespace-pre-wrap">{viewingPast.data?.challenge || '—'}</div>
                </div>
                <div>
                  <div className="font-bold text-accent mb-0.5">One thing you are proud of:</div>
                  <div className="text-accent font-semibold">{viewingPast.data?.proudOf || '—'}</div>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* ── Case 3: Overview & Menu ── */}
      {!activeType && !viewingPast && (
        <div className="space-y-6">
          <CbtHeatmap exercises={exercises} />

          <div className="grid gap-8 lg:grid-cols-3">
            {/* Exercise select cards */}
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-lg font-bold text-fg">Select a CBT Worksheet</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.keys(CBT_TYPES).map((key) => {
                  const spec = CBT_TYPES[key]
                  const Icon = spec.icon
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setActiveType(key)
                        setViewingPast(null)
                      }}
                      className="card border-border bg-surface-2 flex items-start gap-4 p-5 text-left transition hover:border-primary/50 hover:bg-surface cursor-pointer"
                    >
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${spec.color}15`, color: spec.color }}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-fg">{spec.title}</h3>
                        <p className="mt-1 text-xs text-muted">{spec.desc}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Past completed exercises */}
            <div className="card flex flex-col p-5 lg:col-span-1 h-[480px]">
              <h2 className="mb-4 text-base font-bold text-fg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" /> Completed Exercises
              </h2>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {loading ? (
                  <div className="flex items-center justify-center py-10 gap-2 text-muted text-xs">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading exercises...
                  </div>
                ) : exercises.length === 0 ? (
                  <div className="text-center py-10 text-xs text-faint">
                    No completed exercises yet. Select one above to get started.
                  </div>
                ) : (
                  exercises.map((item) => {
                    const spec = CBT_TYPES[item.type] || CBT_TYPES.reframing
                    const date = item.ts ? new Date(item.ts).toLocaleDateString() : '—'
                    return (
                      <div
                        key={item.id}
                        onClick={() => setViewingPast(item)}
                        className="group flex items-center justify-between rounded-xl border border-border bg-surface-2 p-3 text-left transition hover:border-border-strong cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-fg group-hover:text-primary">
                            {spec.title}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-faint">
                            <Calendar className="h-3 w-3" /> {date}
                          </div>
                        </div>
                        <button
                          onClick={(e) => remove(item.id, e)}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger p-1 transition"
                          title="Delete record"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </PageTransition>
  )
}

function CbtHeatmap({ exercises }) {
  const totalCompleted = exercises.length

  const streak = useMemo(() => {
    const uniqueDates = new Set(
      exercises
        .filter(e => e.ts)
        .map(e => new Date(e.ts).toLocaleDateString('sv-SE'))
    )
    let count = 0
    let checkDate = new Date()

    const todayStr = checkDate.toLocaleDateString('sv-SE')
    checkDate.setDate(checkDate.getDate() - 1)
    const yesterdayStr = checkDate.toLocaleDateString('sv-SE')

    if (!uniqueDates.has(todayStr) && !uniqueDates.has(yesterdayStr)) {
      return 0
    }

    let current = uniqueDates.has(todayStr) ? new Date() : checkDate
    while (true) {
      const curStr = current.toLocaleDateString('sv-SE')
      if (uniqueDates.has(curStr)) {
        count++
        current.setDate(current.getDate() - 1)
      } else {
        break
      }
    }
    return count
  }, [exercises])

  const weeks = useMemo(() => {
    const today = new Date()
    const startDate = new Date(today)
    startDate.setDate(today.getDate() - 364)

    const counts = {}
    exercises.forEach(e => {
      if (e.ts) {
        const d = new Date(e.ts).toLocaleDateString('sv-SE')
        counts[d] = (counts[d] || 0) + 1
      }
    })

    const days = []
    const curr = new Date(startDate)
    while (curr <= today) {
      const dateStr = curr.toLocaleDateString('sv-SE')
      days.push({
        date: new Date(curr),
        dateStr,
        count: counts[dateStr] || 0
      })
      curr.setDate(curr.getDate() + 1)
    }

    const startDayOfWeek = startDate.getDay()
    const paddedDays = []
    for (let i = 0; i < startDayOfWeek; i++) {
      paddedDays.push(null)
    }
    paddedDays.push(...days)

    const weeksList = []
    for (let i = 0; i < paddedDays.length; i += 7) {
      weeksList.push(paddedDays.slice(i, i + 7))
    }
    return weeksList
  }, [exercises])

  return (
    <div className="card p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div>
          <h3 className="text-base font-bold text-fg flex items-center gap-2">
            <Smile className="h-5 w-5 text-accent" /> CBT Activity Heatmap
          </h3>
          <p className="text-xs text-muted mt-1">
            Tracking your completed thought reframing and daily reflections over the past year.
          </p>
        </div>

        <div className="flex gap-4">
          <div className="rounded-xl bg-surface-2 border border-border px-4 py-2 text-center min-w-[100px]">
            <div className="text-lg font-bold text-accent tabular-nums">{totalCompleted}</div>
            <div className="text-[10px] text-faint uppercase font-semibold">Total Exercises</div>
          </div>
          <div className="rounded-xl bg-surface-2 border border-border px-4 py-2 text-center min-w-[100px]">
            <div className="text-lg font-bold text-warning flex items-center justify-center gap-1 tabular-nums">
              🔥 {streak}
            </div>
            <div className="text-[10px] text-faint uppercase font-semibold">Daily Streak</div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto pb-3">
        <div className="flex gap-1 min-w-[640px] select-none justify-between">
          {weeks.map((week, wIdx) => (
            <div key={wIdx} className="grid grid-rows-7 gap-1 shrink-0">
              {week.map((day, dIdx) => {
                if (!day) return <div key={dIdx} className="w-3 h-3 bg-transparent rounded-sm" />

                let colorClass = 'bg-surface-3 opacity-60'
                if (day.count === 1) {
                  colorClass = 'bg-[#a78bfa]/40 border border-[#a78bfa]/20 text-[#c4b5fd]'
                } else if (day.count === 2) {
                  colorClass = 'bg-[#a78bfa]/70 border border-[#a78bfa]/45 text-white'
                } else if (day.count >= 3) {
                  colorClass = 'bg-[#a78bfa] text-white shadow-sm shadow-[#a78bfa]/20'
                }

                return (
                  <div
                    key={dIdx}
                    className={`w-3 h-3 rounded-sm ${colorClass} transition-all duration-150 relative group cursor-help`}
                    title={`${day.count} worksheet${day.count !== 1 ? 's' : ''} on ${new Date(day.date).toLocaleDateString()}`}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 whitespace-nowrap bg-bg border border-border text-[10px] font-semibold text-fg px-2.5 py-1 rounded-md shadow-lg pointer-events-none">
                      {day.count} exercise{day.count !== 1 ? 's' : ''} on {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 text-[10px] text-faint mt-3">
        <span>Less</span>
        <div className="w-2.5 h-2.5 bg-surface-3 opacity-60 rounded-sm" />
        <div className="w-2.5 h-2.5 bg-[#a78bfa]/40 border border-[#a78bfa]/20 rounded-sm" />
        <div className="w-2.5 h-2.5 bg-[#a78bfa]/70 border border-[#a78bfa]/45 rounded-sm" />
        <div className="w-2.5 h-2.5 bg-[#a78bfa] rounded-sm" />
        <span>More</span>
      </div>
    </div>
  )
}
