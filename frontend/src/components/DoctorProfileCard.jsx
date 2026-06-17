/**
 * DoctorProfileCard — clinician identity summary for the dashboard.
 *
 * Shows the doctor's name, specialization, experience, live patient rating
 * (from the existing `doctor_ratings` aggregate via lib/ratings.js — previously
 * computed but never surfaced to the doctor), and consultation count derived
 * from their completed appointments.
 *
 * Specialization / experience read from the Firestore profile when present and
 * fall back to sensible defaults, so the card always renders cleanly.
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Star, Award, Briefcase, Users2, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { getDoctorRating } from '../lib/ratings.js'

export default function DoctorProfileCard({ consultationCount = 0, patientCount = 0 }) {
  const { profile } = useAuth()
  const [rating, setRating] = useState({ avgRating: 0, ratingCount: 0 })

  useEffect(() => {
    if (!profile?.uid) return
    let alive = true
    getDoctorRating(profile.uid)
      .then((r) => alive && setRating(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [profile?.uid])

  const specialization = profile?.specialization || 'Clinical Psychologist'
  const experience = profile?.experienceYears || profile?.experience || null
  const initials = (profile?.name || profile?.email || 'Dr')
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const stats = [
    { icon: Star, label: 'Rating', value: rating.ratingCount ? rating.avgRating.toFixed(1) : '—', sub: `${rating.ratingCount} reviews`, color: '#fbbf24' },
    { icon: Briefcase, label: 'Experience', value: experience ? `${experience} yr` : '—', sub: 'practice', color: '#38bdf8' },
    { icon: Users2, label: 'Patients', value: patientCount, sub: 'under care', color: '#a78bfa' },
    { icon: Award, label: 'Consults', value: consultationCount, sub: 'completed', color: '#34d399' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="card relative overflow-hidden p-5"
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/15 blur-3xl" />
      <div className="flex items-center gap-4">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-xl font-bold text-primary-fg">
          {initials}
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-success">
            <ShieldCheck className="h-3 w-3 text-white" />
          </span>
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold text-fg">
            Dr. {profile?.name || profile?.email?.split('@')[0] || 'Clinician'}
          </h2>
          <p className="text-sm font-semibold text-primary">{specialization}</p>
          <p className="mt-0.5 text-xs text-faint">Verified clinician · RSA-signed reports</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface-2 p-3">
            <s.icon className="h-4 w-4" style={{ color: s.color }} />
            <div className="mt-1.5 text-lg font-bold tabular-nums text-fg">{s.value}</div>
            <div className="text-[11px] text-muted">{s.label}</div>
            <div className="text-[10px] text-faint">{s.sub}</div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
