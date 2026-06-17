import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Flame,
  TrendingUp,
  CalendarCheck,
  Moon,
  Activity,
  Droplet,
  Flower2,
  Smartphone,
  Save,
  Loader2,
  Check,
} from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import {
  HABITS,
  HABIT_ICON_META,
  subscribeHabits,
  recordHabit,
  aggregateHabits,
  isoDate,
} from '../lib/habits.js'

const ICONS = {
  sleepHours: Moon,
  exerciseMinutes: Activity,
  waterGlasses: Droplet,
  meditationMinutes: Flower2,
  screenTimeHours: Smartphone,
}

export default function HabitsPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const uid = profile?.uid

  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!uid) return
    return subscribeHabits(
      uid,
      (list) => {
        setEntries(list)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [uid])

  const summary = useMemo(() => aggregateHabits(entries), [entries])

  // Today's already-logged values (from Firestore) act as the baseline; the
  // local `draft` only holds fields the user has actively changed this visit, so
  // sliders show saved values without seeding state in an effect.
  const today = isoDate()
  const todayValues = useMemo(() => {
    const rec = entries.find((e) => e.date === today)
    const vals = {}
    for (const h of HABITS) vals[h.key] = rec && rec[h.key] != null ? rec[h.key] : null
    return vals
  }, [entries, today])

  const valueFor = (key) => (key in draft ? draft[key] : todayValues[key] ?? '')

  const saveToday = async () => {
    setSaving(true)
    setNotice(null)
    try {
      // Persist the merged view (saved baseline + this visit's edits).
      const merged = {}
      for (const h of HABITS) {
        const v = valueFor(h.key)
        if (v !== '' && v != null) merged[h.key] = v
      }
      await recordHabit(uid, merged)
      setNotice({ type: 'ok', text: "Today's habits saved." })
    } catch (err) {
      setNotice({ type: 'err', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageTransition className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <button
        onClick={() => navigate('/dashboard/patient')}
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-accent transition hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </button>

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-fg">Habit Tracker</h1>
        <p className="mt-1 text-sm text-muted">
          Log your daily habits to build healthy routines. Your streaks and adherence feed your
          wellness score and recommendations.
        </p>
      </header>

      {/* Top metrics */}
      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-4">
          <Flame className="h-8 w-8 text-warning" />
          <div>
            <div className="text-xs text-muted">Current Streak</div>
            <div className="text-xl font-bold tabular-nums text-fg">{summary.streak} days</div>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <TrendingUp className="h-8 w-8 text-success" />
          <div>
            <div className="text-xs text-muted">Adherence ({summary.windowDays}d)</div>
            <div className="text-xl font-bold tabular-nums text-fg">
              {Math.round(summary.adherence * 100)}%
            </div>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <CalendarCheck className="h-8 w-8 text-accent" />
          <div>
            <div className="text-xs text-muted">Consistency</div>
            <div className="text-xl font-bold tabular-nums text-fg">
              {summary.loggedDays}/{summary.windowDays} days
            </div>
          </div>
        </div>
      </section>

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

      {/* Daily logger */}
      <section className="card mb-8 p-6">
        <h2 className="mb-5 text-lg font-bold text-fg">Log Today — {today}</h2>
        <div className="space-y-5">
          {HABITS.map((h) => {
            const Icon = ICONS[h.key]
            const color = HABIT_ICON_META[h.key]
            const value = valueFor(h.key)
            return (
              <div key={h.key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex w-44 shrink-0 items-center gap-2">
                  <Icon className="h-5 w-5" style={{ color }} />
                  <span className="text-sm font-semibold text-fg">{h.label}</span>
                  <span className="text-xs text-faint">
                    ({h.higherIsBetter ? 'goal' : 'max'} {h.target}{h.unit})
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={h.max}
                  step={h.step}
                  value={value === '' ? 0 : value}
                  onChange={(e) => setDraft({ ...draft, [h.key]: Number(e.target.value) })}
                  className="flex-1"
                  style={{ accentColor: color }}
                />
                <div className="flex w-20 shrink-0 items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={h.max}
                    step={h.step}
                    value={value}
                    onChange={(e) =>
                      setDraft({ ...draft, [h.key]: e.target.value === '' ? '' : Number(e.target.value) })
                    }
                    className="w-14 rounded-md border border-border bg-surface-2 px-2 py-1 text-center text-sm text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="text-xs text-faint">{h.unit}</span>
                </div>
              </div>
            )
          })}
        </div>
        <button
          onClick={saveToday}
          disabled={saving}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save Today's Habits</>}
        </button>
      </section>

      {/* Per-habit breakdown */}
      <section className="card p-6">
        <h2 className="mb-5 text-lg font-bold text-fg">This Week's Breakdown</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {summary.metrics.map((m) => {
              const Icon = ICONS[m.key]
              const color = HABIT_ICON_META[m.key]
              const pct = Math.round(m.adherence * 100)
              return (
                <div key={m.key} className="rounded-xl border border-border bg-surface-2 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                      <Icon className="h-4 w-4" style={{ color }} /> {m.label}
                    </span>
                    {m.onTrack && <Check className="h-4 w-4 text-success" />}
                  </div>
                  <div className="mb-1 text-2xl font-bold tabular-nums text-fg">
                    {m.avg}
                    <span className="ml-1 text-xs font-normal text-faint">
                      {m.unit} avg · target {m.target}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                  <div className="mt-1 text-[10px] text-faint">
                    {m.loggedDays > 0 ? `${pct}% adherence · ${m.loggedDays} day(s) logged` : 'Not logged yet'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </PageTransition>
  )
}
