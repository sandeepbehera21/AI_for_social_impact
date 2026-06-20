import { useEffect, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Calendar, Clock, Save, CheckSquare, Square } from 'lucide-react'

const DAYS_OF_WEEK = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
]

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: formatHour(i),
}))

function formatHour(h) {
  if (h === 0) return '12:00 AM'
  if (h === 12) return '12:00 PM'
  const isPm = h > 12
  const displayHour = isPm ? h - 12 : h
  return `${displayHour}:00 ${isPm ? 'PM' : 'AM'}`
}

export default function DoctorScheduleSettings() {
  const { profile } = useAuth()
  
  const [workingDays, setWorkingDays] = useState([1, 2, 3, 4, 5])
  const [startHour, setStartHour] = useState(9)
  const [endHour, setEndHour] = useState(17)
  const [slotDuration, setSlotDuration] = useState(30)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  // Load preferences from profile when it resolves
  useEffect(() => {
    if (!profile) return
    if (profile.workingDays) setWorkingDays(profile.workingDays)
    if (profile.startHour !== undefined) setStartHour(profile.startHour)
    if (profile.endHour !== undefined) setEndHour(profile.endHour)
    if (profile.slotDuration !== undefined) setSlotDuration(profile.slotDuration)
  }, [profile])

  const toggleDay = (dayValue) => {
    setWorkingDays((prev) =>
      prev.includes(dayValue) ? prev.filter((d) => d !== dayValue) : [...prev, dayValue]
    )
  }

  const handleSave = async () => {
    if (!profile?.uid) return
    if (startHour >= endHour) {
      setNotice({ type: 'error', text: 'Start hour must be before end hour.' })
      return
    }
    if (workingDays.length === 0) {
      setNotice({ type: 'error', text: 'Select at least one working day.' })
      return
    }

    setSaving(true)
    setNotice(null)
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        workingDays,
        startHour,
        endHour,
        slotDuration,
      })
      setNotice({ type: 'success', text: 'Schedule preferences updated successfully!' })
      setTimeout(() => setNotice(null), 3000)
    } catch (err) {
      console.error('Failed to save schedule settings:', err)
      setNotice({ type: 'error', text: 'Failed to update preferences. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5 mb-4 border-b border-border pb-3">
        <Calendar className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-bold text-fg">Custom Work Schedule</h3>
      </div>

      {notice && (
        <div
          className={`mb-4 rounded-xl border p-3 text-xs font-semibold ${
            notice.type === 'error'
              ? 'border-danger/30 bg-danger-soft text-danger'
              : 'border-success/30 bg-success-soft text-success'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Working Days Checkbox List */}
      <div className="mb-4">
        <label className="block text-xs font-bold text-muted mb-2">Available Days</label>
        <div className="flex flex-wrap gap-2">
          {DAYS_OF_WEEK.map((d) => {
            const active = workingDays.includes(d.value)
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`flex-1 min-w-[56px] text-center rounded-lg border py-2 text-xs font-bold transition cursor-pointer ${
                  active
                    ? 'border-primary bg-primary-soft/10 text-primary'
                    : 'border-border text-muted hover:border-accent hover:bg-surface-2'
                }`}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Hours selectors */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs font-bold text-muted mb-1.5 flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> Start Hour
          </label>
          <select
            value={startHour}
            onChange={(e) => setStartHour(parseInt(e.target.value))}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg outline-none focus:border-primary"
          >
            {HOUR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-muted mb-1.5 flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> End Hour
          </label>
          <select
            value={endHour}
            onChange={(e) => setEndHour(parseInt(e.target.value))}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg outline-none focus:border-primary"
          >
            {HOUR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Slot duration select */}
      <div className="mb-5">
        <label className="block text-xs font-bold text-muted mb-1.5">Consultation Slot Duration</label>
        <select
          value={slotDuration}
          onChange={(e) => setSlotDuration(parseInt(e.target.value))}
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg outline-none focus:border-primary"
        >
          <option value={15}>15 Minutes (Fast Check-ins)</option>
          <option value={30}>30 Minutes (Standard Therapy)</option>
          <option value={45}>45 Minutes (Extended Session)</option>
          <option value={60}>60 Minutes (Full Diagnosis)</option>
        </select>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
      >
        <Save className="h-3.5 w-3.5" />
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  )
}
