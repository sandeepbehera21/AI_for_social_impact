import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Sparkles,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Circle,
  Waves,
  BrainCircuit,
  BookOpen,
  MessageCircle,
  Activity,
  Target,
  Flame,
  TrendingUp,
} from 'lucide-react'
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import PageTransition from '../components/PageTransition.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { subscribeMoodEntries, aggregateMood } from '../lib/moodHistory.js'
import { subscribeHabits, aggregateHabits, isoDate } from '../lib/habits.js'
import {
  subscribeActivePlan,
  generateAndSavePlan,
  setTaskDone,
  planAdherenceToday,
  computeWellnessScore,
  LEVEL_META,
  planStreak,
  saveWellnessSnapshot,
  subscribeWellnessHistory,
} from '../lib/wellness.js'

const TASK_ICONS = {
  meditation: Waves,
  cbt: BrainCircuit,
  journal: BookOpen,
  checkin: MessageCircle,
  habit: Activity,
}

/** Map a plan task's action hint to an in-app route + navigation state. */
function routeForAction(action) {
  if (!action) return ['/dashboard/patient', undefined]
  if (action === 'meditation') return ['/meditation', undefined]
  if (action === 'chat') return ['/chat', undefined]
  if (action === 'journal') return ['/journal', undefined]
  if (action.startsWith('cbt:')) return ['/cbt', { autoOpen: action.split(':')[1] }]
  if (action.startsWith('habit:')) return ['/habits', undefined]
  return ['/dashboard/patient', undefined]
}

export default function WellnessPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const uid = profile?.uid

  const [moodEntries, setMoodEntries] = useState([])
  const [habitEntries, setHabitEntries] = useState([])
  const [journals, setJournals] = useState([])
  const [cbt, setCbt] = useState([])
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [busyTask, setBusyTask] = useState(null)
  const [error, setError] = useState('')
  const [wellnessHistory, setWellnessHistory] = useState([])
  // Track whether we've already saved today's score to avoid repeated writes.
  const savedTodayRef = useRef(false)

  // ── Subscriptions ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!uid) return
    return subscribeMoodEntries(uid, setMoodEntries, () => {})
  }, [uid])
  useEffect(() => {
    if (!uid) return
    return subscribeHabits(uid, setHabitEntries, () => {})
  }, [uid])
  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'journals'), where('patientId', '==', uid))
    return onSnapshot(q, (snap) => setJournals(snap.docs.map((d) => d.data())), () => {})
  }, [uid])
  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'cbt_exercises'), where('patientId', '==', uid))
    return onSnapshot(q, (snap) => setCbt(snap.docs.map((d) => d.data())), () => {})
  }, [uid])
  useEffect(() => {
    if (!uid) return
    return subscribeActivePlan(
      uid,
      (p) => {
        setPlan(p)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [uid])

  // Subscribe to score history for the sparkline
  useEffect(() => {
    if (!uid) return
    return subscribeWellnessHistory(uid, setWellnessHistory, () => {})
  }, [uid])

  const signals = useMemo(
    () => ({
      moodSummary: aggregateMood(moodEntries),
      habitSummary: aggregateHabits(habitEntries),
      journals,
      cbt,
    }),
    [moodEntries, habitEntries, journals, cbt],
  )

  const score = useMemo(() => computeWellnessScore(signals), [signals])
  const adherence = useMemo(() => planAdherenceToday(plan), [plan])
  const streak = useMemo(() => planStreak(plan), [plan])
  const today = isoDate()
  const doneSet = useMemo(() => new Set(plan?.progress?.[today] || []), [plan, today])
  // Hour of day — used to nudge users about incomplete tasks late in the evening
  const hour = new Date().getHours()
  const isEvening = hour >= 17

  // Auto-save today's score to Firestore once per page-load (deduped by date via setDoc merge)
  useEffect(() => {
    if (!uid || !score.hasData || savedTodayRef.current) return
    savedTodayRef.current = true
    saveWellnessSnapshot(uid, score).catch((e) => console.error('[wellness] snapshot save failed', e))
  }, [uid, score])

  const regenerate = async () => {
    setGenerating(true)
    setError('')
    try {
      await generateAndSavePlan(uid, signals)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const toggleTask = async (task) => {
    if (!plan) return
    setBusyTask(task.id)
    try {
      await setTaskDone(plan.id, plan.progress, task.id, !doneSet.has(task.id), today)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyTask(null)
    }
  }

  const levelMeta = LEVEL_META[score.level] || LEVEL_META.steady

  return (
    <PageTransition className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <button
        onClick={() => navigate('/dashboard/patient')}
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-accent transition hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </button>

      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-fg">
            <Sparkles className="h-7 w-7 text-warning" /> Your Wellness Plan
          </h1>
          <p className="mt-1 text-sm text-muted">
            A personalized daily plan generated from your mood, journals, CBT activity and habits.
          </p>
        </div>
        <button
          onClick={regenerate}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent-soft disabled:opacity-40"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {plan ? 'Regenerate Plan' : 'Generate Plan'}
        </button>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Wellness score + history */}
      <section className="card mb-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-faint">Wellness Score</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums text-fg">{score.score}</span>
              <span className="text-sm text-faint">/ 100</span>
              <span
                className="ml-2 rounded-full px-2.5 py-0.5 text-xs font-bold"
                style={{ backgroundColor: `${levelMeta.color}22`, color: levelMeta.color }}
              >
                {levelMeta.label}
              </span>
            </div>
          </div>
          <Target className="h-12 w-12" style={{ color: levelMeta.color }} />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-4">
          {[
            ['Emotional', score.components.emotional],
            ['Habits', score.components.habit],
            ['Engagement', score.components.engagement],
          ].map(([label, val]) => (
            <div key={label}>
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>{label}</span>
                <span className="tabular-nums">{val}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${val}%` }} />
              </div>
            </div>
          ))}
        </div>

        {/* 7-day score history sparkline */}
        {wellnessHistory.length >= 2 && (
          <div className="mt-6 border-t border-border pt-5">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
              <TrendingUp className="h-3.5 w-3.5" /> 7-Day Score History
            </div>
            <ScoreSparkline history={wellnessHistory.slice(-7)} color={levelMeta.color} />
          </div>
        )}
      </section>

      {/* Plan + checklist */}
      {loading ? (
        <div className="card flex items-center gap-2 p-8 text-sm text-muted">
          <Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading your plan…
        </div>
      ) : !plan ? (
        <div className="card p-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Sparkles className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-bold text-fg">No wellness plan yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Generate your first personalized plan. MindEase will choose a focus area and a daily
            checklist based on how you've been feeling and your habits.
          </p>
          <button
            onClick={regenerate}
            disabled={generating}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate My Plan
          </button>
        </div>
      ) : (
        <section className="card p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-xl font-bold text-fg">{plan.title}</h2>
            <div className="flex items-center gap-2">
              {streak > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-bold text-warning">
                  <Flame className="h-3.5 w-3.5" /> {streak}-day streak
                </span>
              )}
              <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">
                {adherence.completed}/{adherence.total} done today
              </span>
            </div>
          </div>
          <p className="mb-5 text-sm text-muted">
            Your focus today. Tap a task to work on it, or check it off when you're done.
          </p>

          {/* Progress bar */}
          <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full bg-primary"
              animate={{ width: `${Math.round(adherence.ratio * 100)}%` }}
            />
          </div>

          <ul className="space-y-3">
            {plan.tasks.map((task) => {
              const Icon = TASK_ICONS[task.type] || Circle
              const done = doneSet.has(task.id)
              const overdue = isEvening && !done
              const [route, state] = routeForAction(task.action)
              return (
                <li
                  key={task.id}
                  className={`flex items-center gap-3 rounded-xl border p-4 transition ${
                    done
                      ? 'border-success/30 bg-success-soft'
                      : overdue
                        ? 'border-warning/40 bg-warning/5'
                        : 'border-border bg-surface-2'
                  }`}
                >
                  <button
                    onClick={() => toggleTask(task)}
                    disabled={busyTask === task.id}
                    className="shrink-0"
                    title={done ? 'Mark as not done' : 'Mark as done'}
                  >
                    {busyTask === task.id ? (
                      <Loader2 className="h-6 w-6 animate-spin text-faint" />
                    ) : done ? (
                      <CheckCircle2 className="h-6 w-6 text-success" />
                    ) : (
                      <Circle className={`h-6 w-6 transition hover:text-primary ${overdue ? 'text-warning' : 'text-faint'}`} />
                    )}
                  </button>
                  <Icon className={`h-5 w-5 shrink-0 ${done ? 'text-success' : overdue ? 'text-warning' : 'text-accent'}`} />
                  <span className={`flex-1 text-sm font-medium ${done ? 'text-muted line-through' : 'text-fg'}`}>
                    {task.label}
                    {overdue && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-warning">· do it tonight</span>}
                  </span>
                  <button
                    onClick={() => navigate(route, state ? { state } : undefined)}
                    className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-primary hover:text-primary"
                  >
                    Start
                  </button>
                </li>
              )
            })}
          </ul>

          {adherence.ratio === 1 && (
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">
              <CheckCircle2 className="h-5 w-5" /> You completed every task today. Wonderful work. 🌱
            </div>
          )}
        </section>
      )}
    </PageTransition>
  )
}

// ---------------------------------------------------------------------------
// Score Sparkline — premium SVG mini-chart showing last N days
// ---------------------------------------------------------------------------
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ScoreSparkline({ history, color = '#38bdf8' }) {
  if (!history || history.length < 2) return null
  const W = 400
  const H = 72
  const PAD_X = 4
  const PAD_Y = 10

  const scores = history.map((h) => h.score)
  const minS = Math.min(...scores)
  const maxS = Math.max(...scores)
  const range = maxS - minS || 1

  const pts = scores.map((s, i) => {
    const x = PAD_X + (i / (scores.length - 1)) * (W - PAD_X * 2)
    const y = H - PAD_Y - ((s - minS) / range) * (H - PAD_Y * 2)
    return [Number(x.toFixed(1)), Number(y.toFixed(1))]
  })

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full overflow-visible"
        style={{ height: '64px' }}
      >
        <defs>
          <linearGradient id="wsg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#wsg)" />
        <path
          d={linePath}
          stroke={color}
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p[0]} cy={p[1]} r="4" fill={color} opacity="0.9" />
            <text
              x={p[0]}
              y={H - 1}
              textAnchor="middle"
              fontSize="9"
              fill="currentColor"
              opacity="0.45"
              className="font-medium"
            >
              {scores[i]}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex justify-between px-1 text-[10px] text-faint">
        {history.map((h) => {
          const d = new Date(h.date + 'T12:00:00')
          return <span key={h.date}>{DAY_LABELS[d.getDay()]}</span>
        })}
      </div>
    </div>
  )
}
