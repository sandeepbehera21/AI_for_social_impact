/**
 * Habit-tracking data layer (Phase 2).
 *
 * Patients write and read their own daily habit records directly through the
 * Firestore client SDK (guarded by security rules). A doctor's view goes through
 * the backend (`getPatientWellnessSummary`) so no client gets cross-user read
 * access.
 *
 * The aggregation here mirrors backend/app/services/habits.py exactly (same
 * metrics, targets, adherence formula, streak rule) so the patient dashboard and
 * the doctor/report views always tell the same story.
 *
 * One record per patient per local day, keyed by a deterministic doc id
 * `${uid}_${date}` so re-logging a day overwrites instead of duplicating:
 *   { patientId, date: 'YYYY-MM-DD', sleepHours, exerciseMinutes, waterGlasses,
 *     meditationMinutes, screenTimeHours, ts, updatedAt }
 */
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase.js'

const DAY = 24 * 60 * 60 * 1000
export const DEFAULT_WINDOW_DAYS = 7

/** Canonical habit metrics — keep in lock-step with backend HABITS. */
export const HABITS = [
  { key: 'sleepHours', label: 'Sleep', unit: 'hrs', target: 8, higherIsBetter: true, icon: 'moon', max: 12, step: 0.5 },
  { key: 'exerciseMinutes', label: 'Exercise', unit: 'min', target: 30, higherIsBetter: true, icon: 'activity', max: 120, step: 5 },
  { key: 'waterGlasses', label: 'Water', unit: 'glasses', target: 8, higherIsBetter: true, icon: 'droplet', max: 16, step: 1 },
  { key: 'meditationMinutes', label: 'Meditation', unit: 'min', target: 10, higherIsBetter: true, icon: 'flower', max: 60, step: 1 },
  { key: 'screenTimeHours', label: 'Screen Time', unit: 'hrs', target: 6, higherIsBetter: false, icon: 'smartphone', max: 16, step: 0.5 },
]
export const HABIT_KEYS = HABITS.map((h) => h.key)

/** Local YYYY-MM-DD for a Date (defaults to now). */
export function isoDate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (Number.isNaN(n)) return null
  return Math.max(0, n)
}

/** Per-metric adherence in [0,1] for a single day's value (null when unlogged). */
export function metricAdherence(spec, value) {
  if (value === null || value === undefined) return null
  if (spec.target <= 0) return 1
  if (spec.higherIsBetter) return Math.min(1, value / spec.target)
  if (value <= spec.target) return 1
  const over = (value - spec.target) / spec.target
  return Math.max(0, 1 - over)
}

/**
 * Upsert today's habit record. Pass only the metrics that changed; the rest are
 * merged. No-op without a patientId.
 */
export async function recordHabit(patientId, metrics = {}, date = isoDate()) {
  if (!patientId) return
  const clean = {}
  for (const key of HABIT_KEYS) {
    if (key in metrics) {
      const v = num(metrics[key])
      if (v !== null) clean[key] = v
    }
  }
  const ref = doc(db, 'habit_entries', `${patientId}_${date}`)
  await setDoc(
    ref,
    { patientId, date, ...clean, ts: Date.now(), updatedAt: serverTimestamp() },
    { merge: true },
  )
}

/** Live subscription to a patient's habit records. Returns the unsubscribe fn. */
export function subscribeHabits(patientId, onChange, onError) {
  const q = query(collection(db, 'habit_entries'), where('patientId', '==', patientId))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data())),
    (err) => {
      console.error('[habits] subscription error', err)
      onError?.(err)
    },
  )
}

function dayRecords(entries) {
  const byDate = {}
  for (const e of entries || []) {
    if (!e.date) continue
    const prev = byDate[e.date]
    if (!prev || (e.ts || 0) >= (prev.ts || 0)) byDate[e.date] = e
  }
  return byDate
}

function parseDate(d) {
  const [y, m, dd] = (d || '').split('-').map(Number)
  if (!y || !m || !dd) return null
  return new Date(y, m - 1, dd)
}

function streak(dates, today) {
  if (!dates.size) return 0
  const set = new Set([...dates].map((d) => parseDate(d)?.getTime()).filter(Boolean))
  let cursor = parseDate(today) || new Date()
  const dayMs = DAY
  let t = cursor.getTime()
  if (!set.has(t)) {
    t -= dayMs // allow anchoring on yesterday if today isn't logged yet
    if (!set.has(t)) return 0
  }
  let count = 0
  while (set.has(t)) {
    count += 1
    t -= dayMs
  }
  return count
}

/**
 * Aggregate raw habit records into adherence / streak / consistency + per-metric
 * breakdown. Mirrors backend habits.summarize().
 * Returns { loggedDays, windowDays, adherence, streak, consistency, today, metrics }.
 */
export function aggregateHabits(entries, { now = Date.now(), windowDays = DEFAULT_WINDOW_DAYS, today = isoDate() } = {}) {
  windowDays = Math.max(1, windowDays)
  const cutoff = now - windowDays * DAY
  const byDate = dayRecords(entries)
  const inWindow = Object.values(byDate).filter((r) => (r.ts || 0) >= cutoff)
  const loggedDays = inWindow.length

  const metricAdhValues = []
  const sortedDesc = Object.values(byDate).sort((a, b) => (b.ts || 0) - (a.ts || 0))

  const metrics = HABITS.map((spec) => {
    const present = inWindow.map((r) => num(r[spec.key])).filter((v) => v !== null)
    const adh = present.map((v) => metricAdherence(spec, v)).filter((a) => a !== null)
    const avg = present.length ? Number((present.reduce((a, b) => a + b, 0) / present.length).toFixed(2)) : 0
    const mAdh = adh.length ? Number((adh.reduce((a, b) => a + b, 0) / adh.length).toFixed(4)) : 0
    if (adh.length) metricAdhValues.push(mAdh)

    let latest = null
    for (const r of sortedDesc) {
      const v = num(r[spec.key])
      if (v !== null) { latest = v; break }
    }
    return {
      key: spec.key, label: spec.label, unit: spec.unit, target: spec.target,
      higherIsBetter: spec.higherIsBetter, avg, adherence: mAdh,
      loggedDays: present.length, latest, onTrack: mAdh >= 0.7,
    }
  })

  const adherence = metricAdhValues.length
    ? Number((metricAdhValues.reduce((a, b) => a + b, 0) / metricAdhValues.length).toFixed(4))
    : 0
  const consistency = Number(Math.min(1, loggedDays / windowDays).toFixed(4))
  const todayRec = byDate[today] || null
  const todayValues = Object.fromEntries(HABITS.map((s) => [s.key, todayRec ? num(todayRec[s.key]) : null]))

  return {
    loggedDays, windowDays, adherence,
    streak: streak(new Set(Object.keys(byDate)), today),
    consistency, today: todayValues, metrics,
  }
}

export const HABIT_ICON_META = {
  sleepHours: '#818cf8',
  exerciseMinutes: '#34d399',
  waterGlasses: '#38bdf8',
  meditationMinutes: '#a78bfa',
  screenTimeHours: '#fb923c',
}
