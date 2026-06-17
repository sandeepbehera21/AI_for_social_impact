import { useEffect, useState } from 'react'
import { Video, Clock, AlertTriangle } from 'lucide-react'
import { setAppointmentStatus, APPT_STATUS } from '../lib/appointments.js'

export default function CountdownJoinButton({ appointment, isDoctor, onJoin, className }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const scheduledTime = new Date(appointment.dateTime).getTime()
  const diff = scheduledTime - now
  const status = appointment.status

  if (status === APPT_STATUS.PENDING) {
    return (
      <span className="text-xs text-muted flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" /> Waiting for approval…
      </span>
    )
  }

  if (status === APPT_STATUS.REJECTED) {
    return (
      <span className="text-xs text-red-400 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5" /> Request rejected
      </span>
    )
  }

  if (status === APPT_STATUS.COMPLETED) {
    return null
  }

  if (status === 'expired') {
    return (
      <button
        disabled
        className="inline-flex items-center gap-2 rounded-lg bg-red-950/30 border border-red-500/20 px-4 py-2 text-xs font-semibold text-red-300 opacity-60 cursor-not-allowed"
      >
        <AlertTriangle className="h-3.5 w-3.5" /> Session Expired
      </button>
    )
  }

  const fiveMins = 5 * 60 * 1000
  const fifteenMins = 15 * 60 * 1000

  // 1. Before T-5 (Join window not open yet)
  if (diff > fiveMins) {
    const totalSecs = Math.floor((diff - fiveMins) / 1000)
    const hours = Math.floor(totalSecs / 3600)
    const minutes = Math.floor((totalSecs % 3600) / 60)
    const seconds = totalSecs % 60

    let timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
    if (hours > 0) {
      timeStr = `${hours}h ${timeStr}`
    }

    return (
      <button
        disabled
        className="inline-flex items-center gap-1.5 rounded-lg bg-surface-3 border border-border px-3 py-1.5 text-xs font-semibold text-muted/60 cursor-not-allowed"
      >
        <Clock className="h-3.5 w-3.5" /> Opens in {timeStr}
      </button>
    )
  }

  // 2. Join Window: T-5 to T+15
  if (now <= scheduledTime + fifteenMins) {
    return (
      <button
        onClick={onJoin}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition hover:brightness-110 cursor-pointer ${
          isDoctor
            ? 'bg-[#00ffd5] text-[#0a0a0f] hover:bg-[#00ffea]'
            : 'bg-[#a78bfa] text-white hover:bg-[#c4b5fd]'
        } ${className || ''}`}
      >
        <Video className="h-3.5 w-3.5" /> {status === 'active' ? 'Rejoin Consultation' : 'Join Consultation'}
      </button>
    )
  }

  // 3. After T+15
  if (status === 'active') {
    // Already active (someone joined in time) -> allow rejoins/reconnects
    return (
      <button
        onClick={onJoin}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition hover:brightness-110 cursor-pointer ${
          isDoctor
            ? 'bg-[#00ffd5] text-[#0a0a0f] hover:bg-[#00ffea]'
            : 'bg-[#a78bfa] text-white hover:bg-[#c4b5fd]'
        } ${className || ''}`}
      >
        <Video className="h-3.5 w-3.5" /> Rejoin Consultation
      </button>
    )
  } else {
    // Past T+15 and status was still approved -> auto-expire client-side
    setTimeout(() => {
      setAppointmentStatus(appointment.id, 'expired').catch(console.error)
    }, 0)

    return (
      <button
        disabled
        className="inline-flex items-center gap-2 rounded-lg bg-red-950/30 border border-red-500/20 px-4 py-2 text-xs font-semibold text-red-300 opacity-60 cursor-not-allowed"
      >
        <AlertTriangle className="h-3.5 w-3.5" /> Session Expired (No-Show)
      </button>
    )
  }
}
