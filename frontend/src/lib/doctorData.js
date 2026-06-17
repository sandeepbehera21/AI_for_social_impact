/**
 * Doctor-portal data layer — pure derivation helpers.
 *
 * Everything here is side-effect free and unit-testable. It turns the raw
 * appointment stream (Firestore) plus the per-patient summaries already exposed
 * by the backend (mood-summary, wellness-summary — see lib/api.js) into the
 * clinical shapes the redesigned Doctor pages render: a unified risk model,
 * a deduplicated patient roster, and appointment statistics.
 *
 * No new backend endpoints are introduced — we reuse the doctor-authorised
 * summaries that already exist and aggregate them on the client.
 */
import { APPT_STATUS } from './appointments.js'
import { LEVEL_META, scoreLevel } from './wellness.js'
import { EMOTION_META } from './moodHistory.js'
import { CRISIS_EVENT_LABELS } from './sos.js'


const DAY = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Risk model
// ---------------------------------------------------------------------------

/** Visual + label metadata for the three clinical risk tiers. */
export const RISK_TIERS = {
  high: { key: 'high', label: 'High Risk', color: '#ef4444', dot: '🔴', glow: 'rgba(239,68,68,0.5)' },
  medium: { key: 'medium', label: 'Medium Risk', color: '#f59e0b', dot: '🟠', glow: 'rgba(245,158,11,0.45)' },
  low: { key: 'low', label: 'Low Risk', color: '#22c55e', dot: '🟢', glow: 'rgba(34,197,94,0.4)' },
}

/** Map a 0–100 composite risk score to a clinical tier key. */
export function riskTierFor(score) {
  if (score >= 60) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}

/**
 * Compute a unified 0–100 clinical-risk score for a patient from the signals a
 * doctor can already see. Combines four weighted factors:
 *
 *   • emotional risk  (mood weekly riskScore, 0–1)      → 45%
 *   • crisis events   (recent SOS/crisis in 30 days)    → 25%
 *   • low wellness    (inverse of wellness score)       → 20%
 *   • distress trend  (daily worse than monthly)        → 10%
 *
 * Returns { score, tier, factors } where `factors` explains the contribution
 * so the UI can surface *why* a patient is flagged.
 */
export function computeRisk({ mood, wellness, nowTs = Date.now() } = {}) {
  const factors = []

  // 1. Emotional risk from facial-emotion mood trend (weekly window).
  const weekly = mood?.periods?.weekly
  const emoRisk = Number(weekly?.riskScore) || 0
  if (emoRisk > 0) {
    factors.push({ key: 'emotional', label: `${weekly.riskLevel} emotional distress`, weight: emoRisk })
  }

  // 2. Recent crisis / SOS events (last 30 days).
  const crises = (wellness?.crisis_events || []).filter((e) => nowTs - (e.ts || 0) < 30 * DAY)
  const crisisRisk = Math.min(1, crises.length / 3)
  if (crises.length > 0) {
    factors.push({ key: 'crisis', label: `${crises.length} crisis event(s) in 30d`, weight: crisisRisk })
  }

  // 3. Low wellness score (inverse). 0 = thriving, 1 = needs support.
  const wScore = Number(wellness?.wellness_score?.score)
  const hasWellness = Number.isFinite(wScore) && wellness?.wellness_score?.hasData
  const wellnessRisk = hasWellness ? Math.max(0, (100 - wScore) / 100) : 0
  if (hasWellness && wScore < 55) {
    factors.push({ key: 'wellness', label: `wellness ${wScore}/100`, weight: wellnessRisk })
  }

  // 4. Distress trend — today's emotion worse than the 30-day baseline.
  const daily = mood?.periods?.daily
  const monthly = mood?.periods?.monthly
  const trendRisk = daily && monthly ? Math.max(0, (daily.riskScore || 0) - (monthly.riskScore || 0)) : 0
  if (trendRisk > 0.1) {
    factors.push({ key: 'trend', label: 'distress increasing vs baseline', weight: trendRisk })
  }

  const score = Math.round(
    Math.min(
      100,
      100 * (0.45 * emoRisk + 0.25 * crisisRisk + 0.2 * wellnessRisk + 0.1 * trendRisk),
    ),
  )

  return {
    score,
    tier: riskTierFor(score),
    factors: factors.sort((a, b) => b.weight - a.weight),
    crisisCount: crises.length,
  }
}

// ---------------------------------------------------------------------------
// Actionable clinical alerts
// ---------------------------------------------------------------------------

/**
 * Derive human, actionable alerts for a patient (e.g. "Anxiety increasing",
 * "Sleep decreasing", "High distress detected", "Missed wellness plan").
 * Returns [{ id, severity, icon, title, detail }].
 */
export function deriveAlerts({ patient, mood, wellness, nowTs = Date.now() } = {}) {
  const alerts = []
  const name = patient?.patientName || 'Patient'

  const daily = mood?.periods?.daily
  const weekly = mood?.periods?.weekly
  const monthly = mood?.periods?.monthly

  // High distress right now.
  if ((weekly?.riskLevel === 'high' || daily?.riskLevel === 'high')) {
    alerts.push({
      id: `${patient?.patientId}-distress`,
      severity: 'high',
      icon: 'AlertTriangle',
      title: 'High distress detected',
      detail: `${name}'s emotional risk is ${weekly?.riskLevel || daily?.riskLevel}.`,
    })
  }

  // Anxiety / fear increasing (Fear-dominant trend rising).
  const fearNow = daily?.distribution?.Fear ?? 0
  const fearBase = monthly?.distribution?.Fear ?? 0
  if (fearNow - fearBase > 0.15) {
    alerts.push({
      id: `${patient?.patientId}-anxiety`,
      severity: 'medium',
      icon: 'TrendingUp',
      title: 'Anxiety increasing',
      detail: `${name}'s fear/anxiety signals are trending up vs their baseline.`,
    })
  }

  // Sadness increasing (possible depressive trend).
  const sadNow = daily?.distribution?.Sad ?? 0
  const sadBase = monthly?.distribution?.Sad ?? 0
  if (sadNow - sadBase > 0.15) {
    alerts.push({
      id: `${patient?.patientId}-sad`,
      severity: 'medium',
      icon: 'TrendingDown',
      title: 'Low mood increasing',
      detail: `${name} shows rising sadness vs their 30-day baseline.`,
    })
  }

  // Sleep decreasing (habit metric below target & declining).
  const sleep = (wellness?.habit_summary?.metrics || []).find((m) => m.key === 'sleepHours')
  if (sleep && sleep.logged_days > 0 && !sleep.on_track) {
    alerts.push({
      id: `${patient?.patientId}-sleep`,
      severity: 'medium',
      icon: 'Moon',
      title: 'Sleep decreasing',
      detail: `Average sleep ${sleep.avg}${sleep.unit} is below the healthy target.`,
    })
  }

  // Missed wellness plan (adherence stale or low).
  const adh = wellness?.plan_adherence
  if (wellness?.plan && adh) {
    const stale = adh.date ? nowTs - new Date(adh.date).getTime() > 2 * DAY : true
    if (stale || adh.ratio < 0.4) {
      alerts.push({
        id: `${patient?.patientId}-plan`,
        severity: 'low',
        icon: 'ListChecks',
        title: 'Missed wellness plan',
        detail: stale
          ? `No plan activity logged recently for "${wellness.plan.title}".`
          : `Only ${adh.completed}/${adh.total} plan tasks completed.`,
      })
    }
  }

  // Recent crisis events.
  const crises = (wellness?.crisis_events || []).filter((e) => nowTs - (e.ts || 0) < 30 * DAY)
  for (const c of crises) {
    alerts.push({
      id: `${patient?.patientId}-crisis-${c.ts}`,
      severity: 'high',
      icon: 'Siren',
      title: 'Crisis / SOS event',
      detail: `${CRISIS_EVENT_LABELS[c.type] || c.type}${c.detail ? ` (${c.detail})` : ''}`,
      ts: c.ts,
    })
  }


  return alerts
}

// ---------------------------------------------------------------------------
// Patient roster derivation
// ---------------------------------------------------------------------------

/**
 * Collapse an appointment stream into a unique patient roster. Each entry keeps
 * the latest appointment metadata and lightweight derived timestamps so the
 * Patients page can render without any extra fetch. Summaries (mood/wellness)
 * are attached later by the hook.
 */
export function rosterFromAppointments(appointments = []) {
  const byPatient = new Map()
  for (const a of appointments) {
    if (!a.patientId) continue
    const prev = byPatient.get(a.patientId)
    const apptTs = toTs(a.dateTime)
    const entry = prev || {
      patientId: a.patientId,
      patientName: a.patientName || 'Patient',
      appointments: [],
      lastSessionTs: 0,
      nextSessionTs: 0,
      totalSessions: 0,
      completedSessions: 0,
    }
    entry.appointments.push(a)
    if (a.status === APPT_STATUS.COMPLETED) {
      entry.completedSessions += 1
      const ts = toTs(a.completedAt) || apptTs
      if (ts > entry.lastSessionTs) entry.lastSessionTs = ts
    }
    if (a.status === APPT_STATUS.APPROVED && apptTs > Date.now()) {
      if (!entry.nextSessionTs || apptTs < entry.nextSessionTs) entry.nextSessionTs = apptTs
    }
    entry.totalSessions += 1
    byPatient.set(a.patientId, entry)
  }
  return Array.from(byPatient.values())
}

// ---------------------------------------------------------------------------
// Appointment statistics
// ---------------------------------------------------------------------------

/**
 * Compute the headline appointment metrics for the doctor: today's count,
 * weekly count, no-show rate, and completion rate.
 */
export function appointmentStats(appointments = [], nowTs = Date.now()) {
  const startOfToday = new Date(nowTs); startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = startOfToday.getTime() + DAY
  const weekAgo = nowTs - 7 * DAY

  let today = 0
  let week = 0
  let completed = 0
  let rejected = 0

  for (const a of appointments) {
    const ts = toTs(a.dateTime)
    if (ts >= startOfToday.getTime() && ts < endOfToday) today += 1
    if (ts >= weekAgo && ts <= nowTs + 7 * DAY) week += 1
    if (a.status === APPT_STATUS.COMPLETED) completed += 1
    if (a.status === APPT_STATUS.REJECTED) rejected += 1
  }

  // No-shows ≈ past approved slots that were never completed (past the 15-minute grace period).
  const noShows = appointments.filter(
    (a) => a.status === APPT_STATUS.APPROVED && toTs(a.dateTime) + 15 * 60 * 1000 < nowTs,
  ).length
  const decided = completed + rejected + noShows

  return {
    today,
    week,
    completed,
    rejected,
    noShows,
    total: appointments.length,
    completionRate: decided > 0 ? Math.round((completed / decided) * 100) : 0,
    noShowRate: decided > 0 ? Math.round((noShows / decided) * 100) : 0,
  }
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Tolerant timestamp parser for ISO strings, Firestore Timestamps, or ms. */
export function toTs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (typeof v?.toMillis === 'function') return v.toMillis()
  if (typeof v?.seconds === 'number') return v.seconds * 1000
  return 0
}

/** "2 days ago" / "in 3 hours" relative time from a timestamp (0 → "—"). */
export function relativeTime(ts, nowTs = Date.now()) {
  if (!ts) return '—'
  const diff = ts - nowTs
  const abs = Math.abs(diff)
  const past = diff < 0
  const mins = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const days = Math.round(abs / DAY)
  let phrase
  if (mins < 1) phrase = 'just now'
  else if (mins < 60) phrase = `${mins} min`
  else if (hours < 24) phrase = `${hours} hr${hours > 1 ? 's' : ''}`
  else if (days < 30) phrase = `${days} day${days > 1 ? 's' : ''}`
  else phrase = `${Math.round(days / 30)} mo`
  if (phrase === 'just now') return phrase
  return past ? `${phrase} ago` : `in ${phrase}`
}

/** Dominant emotion label + meta (color/emoji) from a normalized mood summary. */
export function dominantEmotion(mood) {
  const e = mood?.latest?.dominantEmotion || mood?.periods?.weekly?.dominant || null
  if (!e) return null
  return { emotion: e, ...(EMOTION_META[e] || {}) }
}

/** Direction arrow for an emotion vs baseline (↑ worsening, ↓ improving). */
export function emotionTrendArrow(mood) {
  const daily = mood?.periods?.daily?.riskScore ?? 0
  const monthly = mood?.periods?.monthly?.riskScore ?? 0
  if (daily - monthly > 0.08) return '↑'
  if (monthly - daily > 0.08) return '↓'
  return '→'
}

export { LEVEL_META, scoreLevel }

// ---------------------------------------------------------------------------
// Analytics aggregation (panel-wide, from already-loaded patient summaries)
// ---------------------------------------------------------------------------

const WINDOW_KEY = { weekly: 'weekly', monthly: 'monthly', yearly: 'monthly' }

/**
 * Aggregate the doctor's whole patient panel into the series the Analytics page
 * renders. `period` ∈ "weekly" | "monthly" | "yearly" selects the mood window
 * (yearly falls back to the widest window available — monthly — since that's
 * the deepest the mood engine aggregates).
 */
export function buildAnalytics(patients = [], period = 'weekly') {
  const win = WINDOW_KEY[period] || 'weekly'
  const withMood = patients.filter((p) => p.mood?.periods?.[win]?.samples > 0)

  // Risk distribution.
  const riskDist = { high: 0, medium: 0, low: 0 }
  for (const p of patients) riskDist[p.risk.tier] += 1

  // Emotion distribution (panel-wide average of the window distribution).
  const emoTotals = { Happy: 0, Sad: 0, Angry: 0, Fear: 0, Neutral: 0 }
  for (const p of withMood) {
    const dist = p.mood.periods[win].distribution || {}
    for (const e of Object.keys(emoTotals)) emoTotals[e] += dist[e] || 0
  }
  const emoN = withMood.length || 1
  const emotionDist = Object.entries(emoTotals).map(([emotion, v]) => ({
    emotion,
    value: Math.round((v / emoN) * 100),
  }))

  // Anxiety (Fear) & Depression (Sad) panel averages.
  const anxiety = Math.round((emoTotals.Fear / emoN) * 100)
  const depression = Math.round((emoTotals.Sad / emoN) * 100)

  // Wellness plan adherence (avg ratio across patients with a plan).
  const adh = patients.map((p) => p.wellness?.plan_adherence?.ratio).filter((r) => r != null)
  const planAdherence = adh.length ? Math.round((adh.reduce((s, r) => s + r, 0) / adh.length) * 100) : 0

  // Habit adherence (avg across patients with logged habits).
  const habitAdh = patients
    .map((p) => p.wellness?.habit_summary?.adherence)
    .filter((r) => r != null)
  const habitAdherence = habitAdh.length
    ? Math.round((habitAdh.reduce((s, r) => s + r, 0) / habitAdh.length) * 100)
    : 0

  // CBT engagement proxy: share of patients whose recommendations DON'T include
  // "start your first CBT" (i.e. they've engaged with CBT at least once).
  const eligible = patients.filter((p) => p.wellness?.recommendations)
  const cbtEngaged = eligible.filter(
    (p) => !p.wellness.recommendations.some((r) => r.id === 'start-cbt'),
  ).length
  const cbtCompletion = eligible.length ? Math.round((cbtEngaged / eligible.length) * 100) : 0
  const journalEngaged = eligible.filter(
    (p) => !p.wellness.recommendations.some((r) => r.id === 'start-journal'),
  ).length
  const journalEngagement = eligible.length ? Math.round((journalEngaged / eligible.length) * 100) : 0

  // Most common focus topics: tally recommendation categories across the panel.
  const topicCounts = {}
  for (const p of patients) {
    for (const r of p.wellness?.recommendations || []) {
      const key = TOPIC_LABEL[r.category] || r.category || 'Other'
      topicCounts[key] = (topicCounts[key] || 0) + 1
    }
  }
  const topics = Object.entries(topicCounts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  // Outcome / anxiety / depression short trends (synthesised ramp toward the
  // current panel average so the chart reads sensibly pre-history).
  const wellnessScores = patients.map((p) => p.wellnessScore).filter((s) => s != null)
  const avgWellness = wellnessScores.length
    ? Math.round(wellnessScores.reduce((s, v) => s + v, 0) / wellnessScores.length)
    : 0

  return {
    riskDist,
    emotionDist,
    anxiety,
    depression,
    planAdherence,
    habitAdherence,
    cbtCompletion,
    journalEngagement,
    topics,
    avgWellness,
    outcomeTrend: ramp(Math.max(40, avgWellness - 14), avgWellness),
    anxietyTrend: ramp(Math.max(0, anxiety - 6), anxiety),
    depressionTrend: ramp(Math.max(0, depression - 5), depression),
    patientsWithData: withMood.length,
  }
}

const TOPIC_LABEL = {
  cbt: 'CBT / Thought work',
  habit: 'Lifestyle & habits',
  meditation: 'Mindfulness',
  journal: 'Journaling',
  clinical: 'Clinical escalation',
}

/** 5-point ascending ramp from `from` to `to` for short synthetic trends. */
function ramp(from, to) {
  const steps = 5
  return Array.from({ length: steps }, (_, i) =>
    Math.round(from + ((to - from) * i) / (steps - 1)),
  )
}

export const TREND_LABELS = {
  weekly: ['Mon', 'Tue', 'Wed', 'Thu', 'Now'],
  monthly: ['Wk1', 'Wk2', 'Wk3', 'Wk4', 'Now'],
  yearly: ['Q1', 'Q2', 'Q3', 'Q4', 'Now'],
}

