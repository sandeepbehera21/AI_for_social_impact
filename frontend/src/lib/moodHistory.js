/**
 * Mood-history data layer (facial-emotion trends).
 *
 * Patients write their own samples and read their own history directly through
 * the Firestore client SDK (guarded by security rules). A doctor's view of a
 * patient's mood goes through the backend instead (see api.js
 * `getPatientMoodSummary`), so no client gets blanket cross-user read access.
 *
 * The aggregation here mirrors backend/app/services/mood.py exactly (same
 * windows, same risk thresholds) so the patient dashboard and the doctor/report
 * views always tell the same story.
 *
 * A sample doc in `mood_entries`:
 *   { patientId, dominantEmotion, confidence, scores?, source, ts, createdAt }
 */
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db } from './firebase.js'

export const EMOTIONS = ['Happy', 'Sad', 'Angry', 'Fear', 'Neutral']
const DISTRESS_WEIGHTS = { Sad: 1.0, Fear: 1.0, Angry: 0.5 }
const DAY = 24 * 60 * 60 * 1000
export const WINDOWS = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY }

/** Pick the dominant bucket + its probability from a {Happy,Sad,…} vector. */
export function dominantOf(emotions) {
  if (!emotions) return null
  let best = null
  let bestVal = 0
  for (const e of EMOTIONS) {
    const v = Number(emotions[e]) || 0
    if (v > bestVal) {
      bestVal = v
      best = e
    }
  }
  return best ? { dominant: best, confidence: Number(bestVal.toFixed(4)) } : null
}

/**
 * Persist one mood sample for a patient. No-op without a patientId / signal.
 * Callers throttle the cadence (we sample roughly every 30s while the camera is
 * on and a face is visible) — this never writes per-frame.
 */
export async function recordMood(patientId, { dominant, confidence, scores } = {}) {
  if (!patientId || !dominant) return
  await addDoc(collection(db, 'mood_entries'), {
    patientId,
    dominantEmotion: dominant,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    scores: scores || null,
    source: 'chat-camera',
    ts: Date.now(),
    createdAt: serverTimestamp(),
  })
}

/** Live subscription to a patient's own mood samples. Returns the unsubscribe fn. */
export function subscribeMoodEntries(patientId, onChange, onError) {
  const q = query(collection(db, 'mood_entries'), where('patientId', '==', patientId))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data())),
    (err) => {
      console.error('[mood] subscription error', err)
      onError?.(err)
    },
  )
}

function riskLevel(score) {
  if (score >= 0.6) return 'high'
  if (score >= 0.4) return 'elevated'
  if (score >= 0.2) return 'moderate'
  return 'low'
}

function summariseWindow(period, samples) {
  const counts = Object.fromEntries(EMOTIONS.map((e) => [e, 0]))
  let confTotal = 0
  let n = 0
  for (const s of samples) {
    const emo = s.dominantEmotion
    if (!EMOTIONS.includes(emo)) continue
    counts[emo] += 1
    confTotal += Math.max(0, Math.min(1, Number(s.confidence) || 0))
    n += 1
  }
  if (n === 0) {
    return {
      period,
      samples: 0,
      dominant: null,
      distribution: Object.fromEntries(EMOTIONS.map((e) => [e, 0])),
      avgConfidence: 0,
      riskScore: 0,
      riskLevel: 'low',
    }
  }
  const distribution = Object.fromEntries(
    EMOTIONS.map((e) => [e, Number((counts[e] / n).toFixed(4))]),
  )
  const dominant = EMOTIONS.reduce((a, b) => (counts[b] > counts[a] ? b : a), EMOTIONS[0])
  const risk = Math.min(
    1,
    Object.entries(DISTRESS_WEIGHTS).reduce((sum, [e, w]) => sum + distribution[e] * w, 0),
  )
  return {
    period,
    samples: n,
    dominant,
    distribution,
    avgConfidence: Number((confTotal / n).toFixed(4)),
    riskScore: Number(risk.toFixed(4)),
    riskLevel: riskLevel(risk),
  }
}

/**
 * Aggregate raw samples into daily / weekly / monthly summaries.
 * Returns { totalSamples, latest, periods: { daily, weekly, monthly } }.
 */
export function aggregateMood(entries, now = Date.now()) {
  const clean = (entries || [])
    .filter((e) => EMOTIONS.includes(e.dominantEmotion))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
  const latest = clean.length ? clean[clean.length - 1] : null

  const periods = {}
  for (const [name, span] of Object.entries(WINDOWS)) {
    const cutoff = now - span
    periods[name] = summariseWindow(
      name,
      clean.filter((e) => (e.ts || 0) >= cutoff),
    )
  }

  return {
    totalSamples: clean.length,
    latest: latest
      ? { dominantEmotion: latest.dominantEmotion, confidence: latest.confidence, ts: latest.ts }
      : null,
    periods,
  }
}

/** Display metadata for the five buckets (colour + emoji), shared by the UI. */
export const EMOTION_META = {
  Happy: { color: '#22c55e', emoji: '😊' },
  Sad: { color: '#3b82f6', emoji: '😢' },
  Angry: { color: '#ef4444', emoji: '😠' },
  Fear: { color: '#a855f7', emoji: '😨' },
  Neutral: { color: '#94a3b8', emoji: '😐' },
}

export const RISK_META = {
  low: { label: 'Low', color: '#22c55e' },
  moderate: { label: 'Moderate', color: '#eab308' },
  elevated: { label: 'Elevated', color: '#f97316' },
  high: { label: 'High', color: '#ef4444' },
}

/**
 * Normalise the backend mood-summary shape (periods as a snake_case array, from
 * GET /api/patients/:id/mood-summary) into the same camelCase, period-keyed
 * shape `aggregateMood` returns — so one <MoodTrends> renders both.
 */
export function normalizeServerSummary(summary) {
  const periods = {}
  for (const p of summary?.periods || []) {
    periods[p.period] = {
      period: p.period,
      samples: p.samples ?? 0,
      dominant: p.dominant ?? null,
      distribution: p.distribution || Object.fromEntries(EMOTIONS.map((e) => [e, 0])),
      avgConfidence: p.avg_confidence ?? 0,
      riskScore: p.risk_score ?? 0,
      riskLevel: p.risk_level ?? 'low',
    }
  }
  for (const name of Object.keys(WINDOWS)) {
    if (!periods[name]) {
      periods[name] = {
        period: name,
        samples: 0,
        dominant: null,
        distribution: Object.fromEntries(EMOTIONS.map((e) => [e, 0])),
        avgConfidence: 0,
        riskScore: 0,
        riskLevel: 'low',
      }
    }
  }
  return {
    totalSamples: summary?.total_samples ?? 0,
    latest: summary?.latest ?? null,
    periods,
  }
}
