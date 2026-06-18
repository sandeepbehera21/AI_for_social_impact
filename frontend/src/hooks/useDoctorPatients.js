/**
 * useDoctorPatients — single data source for the redesigned Doctor portal.
 *
 * Subscribes to the doctor's appointment stream (Firestore) and, for every
 * unique patient, fetches the doctor-authorised mood + wellness summaries
 * (lib/api.js — backend-mediated, no blanket cross-user reads). It then derives
 * the unified clinical risk model, alerts, and roster used by the Dashboard,
 * Patients/Risk Center, Appointments, and Analytics pages.
 *
 * Summaries are fetched once per patient and memoised for the session, so
 * navigating between doctor pages is instant and we never re-hit the backend
 * for data we already hold. Errors degrade gracefully (a patient simply has no
 * summary) — the portal never breaks on a missing signal.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { subscribeAppointments } from '../lib/appointments.js'
import { getPatientMoodSummary, getPatientWellnessSummary } from '../lib/api.js'
import { normalizeServerSummary } from '../lib/moodHistory.js'
import {
  rosterFromAppointments,
  computeRisk,
  deriveAlerts,
  appointmentStats,
  dominantEmotion,
  emotionTrendArrow,
} from '../lib/doctorData.js'

// Module-level cache: patientId → { mood, wellness } (survives page switches).
const summaryCache = new Map()

export function useDoctorPatients() {
  const { profile } = useAuth()
  const [appointments, setAppointments] = useState([])
  const [apptError, setApptError] = useState('')
  const [summaries, setSummaries] = useState(() => new Map(summaryCache))
  const [loadingSummaries, setLoadingSummaries] = useState(false)
  const inFlight = useRef(new Set())

  // 1. Live appointment subscription for this doctor.
  useEffect(() => {
    if (!profile?.uid) return
    return subscribeAppointments('doctorId', profile.uid, setAppointments, (err) =>
      setApptError(err.message),
    )
  }, [profile?.uid])

  // 2. Unique patient ids from the appointment stream.
  const patientIds = useMemo(() => {
    const ids = new Set()
    for (const a of appointments) if (a.patientId) ids.add(a.patientId)
    return Array.from(ids)
  }, [appointments])

  // 3. Fetch missing summaries (mood + wellness) per patient, once each.
  useEffect(() => {
    let alive = true
    const missing = patientIds.filter((id) => {
      if (inFlight.current.has(id)) return false
      if (!summaryCache.has(id)) return true
      
      const patientAppointments = appointments.filter((a) => a.patientId === id)
      const hasConsent = patientAppointments.some((a) => a.shareConsent === true && (a.status === 'approved' || a.status === 'completed'))
      const cached = summaryCache.get(id)
      if (hasConsent && cached && cached.noConsent === true) {
        return true
      }
      return false
    })

    if (missing.length === 0) return
    missing.forEach((id) => inFlight.current.add(id))
    setLoadingSummaries(true)

    Promise.all(
      missing.map(async (id) => {
        const patientAppointments = appointments.filter((a) => a.patientId === id)
        const hasConsent = patientAppointments.some((a) => a.shareConsent === true && (a.status === 'approved' || a.status === 'completed'))
        
        if (!hasConsent) {
          summaryCache.set(id, { mood: null, wellness: null, noConsent: true })
          inFlight.current.delete(id)
          return
        }

        const [mood, wellness] = await Promise.all([
          getPatientMoodSummary(id).then(normalizeServerSummary).catch(() => null),
          getPatientWellnessSummary(id).catch(() => null),
        ])
        summaryCache.set(id, { mood, wellness, noConsent: false })
        inFlight.current.delete(id)
      }),
    ).finally(() => {
      if (!alive) return
      setSummaries(new Map(summaryCache))
      setLoadingSummaries(false)
    })

    return () => {
      alive = false
    }
  }, [patientIds, appointments])

  // 4. Build the enriched roster: roster metadata + summaries + risk + alerts.
  // Stamp "now" once (lazy init) so risk/alert windows are render-pure.
  const [nowTs] = useState(() => Date.now())
  const patients = useMemo(() => {
    const base = rosterFromAppointments(appointments)
    return base
      .map((p) => {
        const consented = p.appointments.some((a) => a.shareConsent === true && (a.status === 'approved' || a.status === 'completed'))
        const s = consented ? (summaries.get(p.patientId) || {}) : {}
        const mood = s.mood || null
        const wellness = s.wellness || null
        
        let risk
        if (consented) {
          risk = computeRisk({ mood, wellness, nowTs })
        } else {
          risk = {
            score: null,
            tier: 'pending',
            factors: [{ key: 'consent', label: 'Consent Pending', weight: 0 }],
          }
        }

        const alerts = consented ? deriveAlerts({ patient: p, mood, wellness, nowTs }) : []
        return {
          ...p,
          mood,
          wellness,
          risk,
          alerts,
          dominant: consented ? dominantEmotion(mood) : null,
          trendArrow: consented ? emotionTrendArrow(mood) : null,
          wellnessScore: consented ? (wellness?.wellness_score?.score ?? null) : null,
          loaded: consented ? summaries.has(p.patientId) : true,
        }
      })
      .sort((a, b) => {
        if (a.risk.tier === 'pending' && b.risk.tier !== 'pending') return 1
        if (a.risk.tier !== 'pending' && b.risk.tier === 'pending') return -1
        return b.risk.score - a.risk.score
      })
  }, [appointments, summaries, nowTs])

  // 5. Portfolio-level aggregates.
  const stats = useMemo(() => appointmentStats(appointments, nowTs), [appointments, nowTs])

  const byTier = useMemo(() => {
    const groups = { high: [], medium: [], low: [], pending: [] }
    for (const p of patients) {
      if (groups[p.risk.tier]) {
        groups[p.risk.tier].push(p)
      } else {
        groups.pending.push(p)
      }
    }
    return groups
  }, [patients])

  const allAlerts = useMemo(
    () =>
      patients
        .flatMap((p) => p.alerts.map((a) => ({ ...a, patient: p })))
        .sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    [patients],
  )

  return {
    appointments,
    patients,
    byTier,
    stats,
    allAlerts,
    loadingSummaries,
    apptError,
    nowTs,
  }
}

function severityRank(s) {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1
}
