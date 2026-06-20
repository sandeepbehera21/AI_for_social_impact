import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Stethoscope,
  CalendarClock,
  Loader2,
  Video,
  CheckCircle2,
  Clock,
  Star,
  BadgeCheck,
  X,
  ShieldCheck,
  Shield,
  Check,
  AlertTriangle,
} from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import VerifyReportButton from '../components/VerifyReportButton.jsx'
import StarRating from '../components/StarRating.jsx'
import RateDoctorModal from '../components/RateDoctorModal.jsx'
import CountdownJoinButton from '../components/CountdownJoinButton.jsx'
import { db } from '../lib/firebase.js'
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore'
import { useAuth } from '../context/AuthContext.jsx'
import { getSessionDetail } from '../lib/api.js'
import {
  listDoctors,
  requestAppointment,
  subscribeAppointments,
  setAppointmentStatus,
  APPT_STATUS,
} from '../lib/appointments.js'
import { joinWaitlist, notifyNextInWaitlist } from '../lib/waitlist.js'
import { getDoctorRatingsBatch, hasRated } from '../lib/ratings.js'
import { toTs } from '../lib/doctorData.js'
import {
  todayISODate,
  dayTimeSlots,
  combineDateTime,
  formatDateTime,
} from '../lib/datetime.js'

const SLOTS = dayTimeSlots(9, 17, 30)

export default function ConsultDocPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  // ── Doctor list + ratings ─────────────────────────────────────────────────
  const [doctors, setDoctors] = useState([])
  const [doctorRatings, setDoctorRatings] = useState(new Map()) // uid → { avgRating, ratingCount }
  const [loadingDoctors, setLoadingDoctors] = useState(true)

  // ── Appointments ──────────────────────────────────────────────────────────
  const [appointments, setAppointments] = useState([])
  const [ratedMap, setRatedMap] = useState({}) // appointmentId → starValue (after rating)

  // ── Booking form ──────────────────────────────────────────────────────────
  const [selectedDoctor, setSelectedDoctor] = useState(null)
  const [date, setDate] = useState(todayISODate())
  const [slot, setSlot] = useState('')
  const [booking, setBooking] = useState(false)
  const [notice, setNotice] = useState(null) // { type: 'ok'|'err', text }

  // ── Waitlist & Slot availability ──────────────────────────────────────────
  const [bookedSlots, setBookedSlots] = useState([])
  const [waitlistedSlots, setWaitlistedSlots] = useState([])
  const [waitlistNotifications, setWaitlistNotifications] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  const slotsForDoctor = useMemo(() => {
    if (!selectedDoctor) return []
    const start = selectedDoctor.startHour !== undefined ? selectedDoctor.startHour : 9
    const end = selectedDoctor.endHour !== undefined ? selectedDoctor.endHour : 17
    const duration = selectedDoctor.slotDuration !== undefined ? selectedDoctor.slotDuration : 30
    return dayTimeSlots(start, end, duration)
  }, [selectedDoctor])

  const isDoctorAvailableOnDay = useMemo(() => {
    if (!selectedDoctor || !date) return true
    const parts = date.split('-')
    if (parts.length !== 3) return true
    const d = new Date(parts[0], parts[1] - 1, parts[2])
    const dayOfWeek = d.getDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const workingDays = selectedDoctor.workingDays || [1, 2, 3, 4, 5]
    return workingDays.includes(dayOfWeek)
  }, [selectedDoctor, date])

  const doctorWorkingDaysText = useMemo(() => {
    if (!selectedDoctor) return ''
    const workingDays = selectedDoctor.workingDays || [1, 2, 3, 4, 5]
    const labels = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
    return workingDays.map((d) => labels[d]).join(', ')
  }, [selectedDoctor])

  // Fetch booked slots for the selected doctor on the selected date
  useEffect(() => {
    if (!selectedDoctor?.uid || !date) {
      setBookedSlots([])
      return
    }
    setLoadingSlots(true)
    const q = query(
      collection(db, 'appointments'),
      where('doctorId', '==', selectedDoctor.uid),
      where('status', 'in', ['pending', 'approved'])
    )
    const unsub = onSnapshot(q, (snap) => {
      const slotsList = []
      snap.docs.forEach((doc) => {
        const data = doc.data()
        if (data.dateTime && data.dateTime.startsWith(date)) {
          const timePart = data.dateTime.split('T')[1]?.slice(0, 5)
          if (timePart) slotsList.push(timePart)
        }
      })
      setBookedSlots(slotsList)
      setLoadingSlots(false)
    }, (err) => {
      console.error('[ConsultDocPage] Error loading slots:', err)
      setLoadingSlots(false)
    })
    return unsub
  }, [selectedDoctor?.uid, date])

  // Fetch slots this patient has waitlisted for
  useEffect(() => {
    if (!profile?.uid || !selectedDoctor?.uid || !date) {
      setWaitlistedSlots([])
      return
    }
    const q = query(
      collection(db, 'waitlist'),
      where('patientId', '==', profile.uid),
      where('doctorId', '==', selectedDoctor.uid),
      where('status', '==', 'waiting')
    )
    const unsub = onSnapshot(q, (snap) => {
      const waitlistSlots = []
      snap.docs.forEach((doc) => {
        const data = doc.data()
        if (data.dateTime && data.dateTime.startsWith(date)) {
          const timePart = data.dateTime.split('T')[1]?.slice(0, 5)
          if (timePart) waitlistSlots.push(timePart)
        }
      })
      setWaitlistedSlots(waitlistSlots)
    })
    return unsub
  }, [profile?.uid, selectedDoctor?.uid, date])

  // Fetch active waitlist notifications for this patient
  useEffect(() => {
    if (!profile?.uid) return
    const q = query(
      collection(db, 'waitlist'),
      where('patientId', '==', profile.uid),
      where('status', '==', 'notified')
    )
    const unsub = onSnapshot(q, (snap) => {
      setWaitlistNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [profile?.uid])

  // ── Rating modal ──────────────────────────────────────────────────────────
  const [ratingAppt, setRatingAppt] = useState(null) // appointment being rated
  const [viewingReportId, setViewingReportId] = useState(null) // report being viewed in modal

  // ── Load doctors + their aggregate ratings ────────────────────────────────
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const docs = await listDoctors()
        if (!alive) return
        setDoctors(docs)
        // Batch-fetch ratings in parallel
        const ratingsMap = await getDoctorRatingsBatch(docs.map((d) => d.uid))
        if (alive) setDoctorRatings(ratingsMap)
      } catch (err) {
        if (alive) setNotice({ type: 'err', text: err.message })
      } finally {
        if (alive) setLoadingDoctors(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // ── Live-subscribe to this patient's appointments ─────────────────────────
  useEffect(() => {
    if (!profile?.uid) return
    return subscribeAppointments('patientId', profile.uid, setAppointments, (err) =>
      setNotice({ type: 'err', text: err.message }),
    )
  }, [profile?.uid])

  // ── Check which completed appointments are already rated ──────────────────
  useEffect(() => {
    if (!profile?.uid) return
    const completed = appointments.filter(
      (a) => a.status === APPT_STATUS.COMPLETED && !(a.id in ratedMap),
    )
    completed.forEach(async (a) => {
      const already = await hasRated(a.id, profile.uid).catch(() => false)
      if (already) setRatedMap((prev) => ({ ...prev, [a.id]: true }))
    })
  }, [appointments, profile?.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const upcoming = useMemo(
    () => {
      const now = Date.now()
      return appointments.filter(
        (a) =>
          a.status === APPT_STATUS.PENDING ||
          a.status === 'active' ||
          (a.status === APPT_STATUS.APPROVED && toTs(a.dateTime) + 15 * 60 * 1000 >= now),
      )
    },
    [appointments],
  )
  const history = useMemo(
    () => {
      const now = Date.now()
      return appointments.filter(
        (a) =>
          a.status === APPT_STATUS.COMPLETED ||
          a.status === APPT_STATUS.REJECTED ||
          a.status === 'expired' ||
          (a.status === APPT_STATUS.APPROVED && toTs(a.dateTime) + 15 * 60 * 1000 < now),
      )
    },
    [appointments],
  )

  // ── Book appointment ──────────────────────────────────────────────────────
  const book = async () => {
    if (!selectedDoctor || !slot) {
      setNotice({ type: 'err', text: 'Pick a doctor and a time slot first.' })
      return
    }
    setBooking(true)
    setNotice(null)
    try {
      await requestAppointment({
        patient: profile,
        doctor: selectedDoctor,
        dateTime: combineDateTime(date, slot),
      })
      setNotice({
        type: 'ok',
        text: `Request sent to Dr. ${selectedDoctor.name || selectedDoctor.email}. You'll see it as "pending" below.`,
      })
      setSlot('')
    } catch (err) {
      setNotice({ type: 'err', text: err.message })
    } finally {
      setBooking(false)
    }
  }

  const handleBookingAction = async () => {
    if (!selectedDoctor || !slot) {
      setNotice({ type: 'err', text: 'Pick a doctor and a time slot first.' })
      return
    }

    const isBooked = bookedSlots.includes(slot)
    const isWaitlisted = waitlistedSlots.includes(slot)

    if (isBooked) {
      if (isWaitlisted) {
        setNotice({ type: 'err', text: 'You are already on the waitlist for this slot.' })
        return
      }
      setBooking(true)
      setNotice(null)
      try {
        await joinWaitlist({
          patient: profile,
          doctorId: selectedDoctor.uid,
          doctorName: selectedDoctor.name || selectedDoctor.email,
          dateTime: combineDateTime(date, slot),
        })
        setNotice({
          type: 'ok',
          text: `You have joined the waitlist for Dr. ${selectedDoctor.name || selectedDoctor.email} on ${date} at ${slot}. You will be notified if this slot becomes available.`,
        })
      } catch (err) {
        setNotice({ type: 'err', text: err.message })
      } finally {
        setBooking(false)
      }
    } else {
      book()
    }
  }

  const onRated = (apptId, stars) => {
    setRatedMap((prev) => ({ ...prev, [apptId]: stars }))
  }

  return (
    <PageTransition className="mx-auto max-w-6xl px-5 py-10">
      {/* Header */}
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl flex items-center gap-3">
          <Stethoscope className="h-8 w-8 text-primary" />
          Clinical Consultation
        </h1>
        <p className="text-muted">
          Book live video consultation slots with licensed doctors, view your pending sessions, and access cryptographic medical reports.
        </p>
      </header>

      {/* Waitlist Notifications Banner */}
      {waitlistNotifications.length > 0 && (
        <div className="mb-6 space-y-3">
          {waitlistNotifications.map((notif) => (
            <div
              key={notif.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-accent/40 bg-accent-soft p-4 text-sm text-accent"
            >
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <div className="font-semibold text-fg">Slot Available with Dr. {notif.doctorName}!</div>
                  <div className="text-xs text-muted">
                    The slot on {new Date(notif.dateTime).toLocaleString()} is now open. Would you like to book it?
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      await requestAppointment({
                        patient: profile,
                        doctor: { uid: notif.doctorId, name: notif.doctorName, email: '' },
                        dateTime: notif.dateTime,
                      })
                      await updateDoc(doc(db, 'waitlist', notif.id), { status: 'booked' })
                      setNotice({ type: 'ok', text: 'Successfully booked slot from waitlist!' })
                    } catch (err) {
                      setNotice({ type: 'err', text: err.message })
                    }
                  }}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-fg hover:bg-primary-hover transition cursor-pointer"
                >
                  Book Now
                </button>
                <button
                  onClick={async () => {
                    try {
                      await updateDoc(doc(db, 'waitlist', notif.id), { status: 'dismissed' })
                    } catch (err) {
                      setNotice({ type: 'err', text: err.message })
                    }
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 transition cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notice Banner */}
      {notice && (
        <div
          className={`mb-6 rounded-xl border p-4 text-sm ${
            notice.type === 'err'
              ? 'border-danger/40 bg-danger-soft text-danger'
              : 'border-success/40 bg-success-soft text-success'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* ── Main 2-col grid: Doctors | Booking ── */}
      <div className="grid gap-6 lg:grid-cols-5">

        {/* ── Available Doctors list ── */}
        <section className="card p-6 lg:col-span-2">
          <h2 className="mb-5 flex items-center gap-2 text-lg font-bold text-accent">
            <Stethoscope className="h-5 w-5" />
            Available Doctors
          </h2>

          {loadingDoctors ? (
            <div className="flex items-center gap-2 text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading doctors…
            </div>
          ) : doctors.length === 0 ? (
            <p className="text-sm text-muted">
              No doctors are currently online/available.
            </p>
          ) : (
            <ul className="space-y-3">
              {doctors.map((d) => {
                const active = selectedDoctor?.uid === d.uid
                const rating = doctorRatings.get(d.uid) || { avgRating: 0, ratingCount: 0 }

                return (
                  <li key={d.uid}>
                    <button
                      onClick={() => { setSelectedDoctor(d); setSlot('') }}
                      className={`w-full rounded-xl border p-4 text-left transition ${
                        active
                          ? 'border-accent bg-accent-soft shadow-sm'
                          : 'border-border hover:border-accent hover:bg-surface-2'
                      }`}
                    >
                      {/* Doctor name row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {/* Avatar circle */}
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent"
                          >
                            {(d.name || d.email || 'D')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0 text-left">
                            <div className="truncate font-semibold text-fg">
                              Dr. {d.name || d.email}
                            </div>
                            {d.specialization && (
                              <div className="text-[10px] font-bold text-accent">
                                {d.specialization}
                              </div>
                            )}
                            <div className="truncate text-xxs text-faint">
                              {d.experience !== undefined && d.experience !== null ? `${d.experience} yrs exp ` : ''}
                              {d.clinicAffiliation ? `• ${d.clinicAffiliation}` : ''}
                            </div>
                          </div>
                        </div>
                        {active && (
                          <BadgeCheck className="h-4 w-4 shrink-0 text-accent" />
                        )}
                      </div>

                      {/* Rating row */}
                      <div className="mt-3 flex items-center gap-2">
                        <StarRating
                          value={rating.avgRating}
                          size="sm"
                          showValue={rating.ratingCount > 0}
                          count={rating.ratingCount}
                        />
                        {rating.ratingCount === 0 && (
                          <span className="text-xs text-faint">New doctor</span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* ── Slot picker / booking form ── */}
        <section className="card p-6 lg:col-span-3">
          <h2 className="mb-5 flex items-center gap-2 text-lg font-bold text-accent">
            <CalendarClock className="h-5 w-5" />
            Book a Session
          </h2>

          {/* Selected doctor preview */}
          <div className="mb-5 rounded-xl border border-border bg-surface-2 px-4 py-3">
            {selectedDoctor ? (
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-base font-bold text-accent"
                >
                  {(selectedDoctor.name || selectedDoctor.email || 'D')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="font-bold text-fg text-base">
                    Dr. {selectedDoctor.name || selectedDoctor.email}
                  </div>
                  {selectedDoctor.specialization && (
                    <div className="text-xs font-bold text-accent mt-0.5">
                      {selectedDoctor.specialization}
                    </div>
                  )}
                  <div className="text-xxs text-muted mt-0.5">
                    {selectedDoctor.experience !== undefined && selectedDoctor.experience !== null ? `${selectedDoctor.experience} Years Experience ` : ''}
                    {selectedDoctor.clinicAffiliation ? `| ${selectedDoctor.clinicAffiliation}` : ''}
                  </div>
                  {selectedDoctor.bio && (
                    <p className="mt-2 text-xs text-muted italic leading-relaxed border-t border-border/40 pt-2">
                      "{selectedDoctor.bio}"
                    </p>
                  )}
                  <div className="mt-2.5 flex items-center">
                    {(() => {
                      const r = doctorRatings.get(selectedDoctor.uid)
                      return r?.ratingCount > 0 ? (
                        <StarRating value={r.avgRating} size="sm" showValue count={r.ratingCount} />
                      ) : (
                        <span className="text-xs text-faint">No reviews yet</span>
                      )
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted">
                ← Select a doctor from the list to begin
              </span>
            )}
          </div>

          {/* Date */}
          <label className="mb-1 block text-sm font-medium text-muted">Date</label>
          <input
            type="date"
            min={todayISODate()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mb-5 w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />

          {/* Time slots */}
          <label className="mb-2 block text-sm font-medium text-muted">Time slot</label>
          
          {!isDoctorAvailableOnDay ? (
            <div className="mb-6 rounded-xl border border-warning/30 bg-warning-soft/10 p-4 text-center text-sm text-warning flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-warning mt-0.5" />
              <div className="text-left">
                <div className="font-bold">Not Available on this Day</div>
                <div className="text-xs text-muted mt-1 leading-relaxed">
                  Dr. {selectedDoctor.name || selectedDoctor.email} is not scheduled to work on this day.
                </div>
                <div className="text-xs font-semibold text-accent mt-2">
                  Available days: {doctorWorkingDaysText || 'Mon-Fri'}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slotsForDoctor.map((s) => {
                  const isBooked = bookedSlots.includes(s)
                  const isWaitlisted = waitlistedSlots.includes(s)

                  let btnClass = 'border-border text-muted hover:border-accent'
                  if (slot === s) {
                    btnClass = 'border-accent bg-accent-soft font-semibold text-accent'
                  } else if (isBooked) {
                    btnClass = 'border-warning/45 text-warning bg-warning/5 hover:border-warning'
                  }

                  return (
                    <button
                      key={s}
                      onClick={() => setSlot(s)}
                      title={isBooked ? (isWaitlisted ? 'You are waitlisted for this slot' : 'Slot is booked - click to join waitlist') : ''}
                      className={`rounded-lg border py-2 text-sm transition flex flex-col items-center justify-center cursor-pointer ${btnClass}`}
                    >
                      <span>{s}</span>
                      {isBooked && (
                        <span className="text-[8px] font-semibold uppercase tracking-wider opacity-80">
                          {isWaitlisted ? 'Waitlisted' : 'Full'}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Custom Time Slot Picker */}
              <div className="mb-6 rounded-xl border border-dashed border-border p-4 bg-surface-2/30">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-accent" />
                  Or Choose a Custom Time (For Testing)
                </label>
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={slot && !slotsForDoctor.includes(slot) ? slot : ''}
                    onChange={(e) => {
                      const val = e.target.value
                      if (val) setSlot(val)
                    }}
                    className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  />
                  {slot && !slotsForDoctor.includes(slot) && (
                    <button
                      onClick={() => setSlot('')}
                      className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-semibold text-danger hover:bg-danger hover:text-white transition cursor-pointer"
                    >
                      Clear Custom
                    </button>
                  )}
                </div>
                {slot && !slotsForDoctor.includes(slot) && (
                  <p className="mt-2 text-xs text-accent font-medium animate-pulse">
                    Selected Custom Slot: <span className="font-bold underline">{slot}</span>
                  </p>
                )}
              </div>
            </>
          )}

          {/* Book button */}
          <button
            onClick={handleBookingAction}
            disabled={booking || !selectedDoctor || !slot || !isDoctorAvailableOnDay || (bookedSlots.includes(slot) && waitlistedSlots.includes(slot))}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40 cursor-pointer"
          >
            {booking ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
            ) : bookedSlots.includes(slot) ? (
              waitlistedSlots.includes(slot) ? (
                <>Waitlisted for this slot</>
              ) : (
                <><Clock className="h-4 w-4" /> Join Waitlist</>
              )
            ) : (
              <><CalendarClock className="h-4 w-4" /> Request Appointment</>
            )}
          </button>
        </section>
      </div>

      {/* ── Upcoming & Pending appointments ── */}
      <section className="mt-10">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-fg">
          <Clock className="h-5 w-5 text-accent" /> Upcoming &amp; Pending
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">No upcoming appointments yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((a) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="card p-5"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-fg">Dr. {a.doctorName}</span>
                  <StatusBadge status={a.status} />
                </div>
                <div className="mb-4 text-sm text-muted">{formatDateTime(a.dateTime)}</div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <CountdownJoinButton
                    appointment={a}
                    isDoctor={false}
                    onJoin={() => navigate(`/consultation/${a.id}`)}
                  />
                  {a.status === APPT_STATUS.APPROVED && (
                    a.shareConsent === true ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-success bg-success/10 px-2.5 py-1.5 rounded-lg">
                        <Check className="h-3.5 w-3.5" /> Consented
                      </span>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            await updateDoc(doc(db, 'appointments', a.id), { shareConsent: true })
                            setNotice({ type: 'ok', text: 'Health data sharing consent granted successfully.' })
                          } catch (err) {
                            setNotice({ type: 'err', text: err.message })
                          }
                        }}
                        className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-fg hover:bg-primary-hover transition cursor-pointer"
                      >
                        <Shield className="h-3.5 w-3.5" /> Share Health Data
                      </button>
                    )
                  )}
                  {(a.status === APPT_STATUS.PENDING || a.status === APPT_STATUS.APPROVED) && (
                    <button
                      onClick={async () => {
                        if (!window.confirm('Cancel this appointment?')) return
                        try {
                          await setAppointmentStatus(a.id, APPT_STATUS.REJECTED)
                          await notifyNextInWaitlist(a.doctorId, a.dateTime)
                          setNotice({ type: 'ok', text: 'Appointment cancelled successfully.' })
                        } catch (err) {
                          setNotice({ type: 'err', text: err.message })
                        }
                      }}
                      className="inline-flex items-center justify-center rounded-lg border border-danger/40 bg-danger-soft px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger hover:text-white transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* ── Past sessions ── */}
      {history.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
            <CheckCircle2 className="h-5 w-5 text-muted" /> Past Sessions
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {history.map((a) => {
              const alreadyRated = ratedMap[a.id]
              return (
                <div key={a.id} className="glass rounded-xl p-5 opacity-90">
                  <div className="mb-1 flex items-center justify-between">
                     <span className="font-semibold text-white">Dr. {a.doctorName}</span>
                     <StatusBadge status={a.status} />
                  </div>
                  <div className="mb-4 text-sm text-white/50">
                    {formatDateTime(a.dateTime)}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Verify PDF report */}
                    {a.status === APPT_STATUS.COMPLETED && (
                      <>
                        <VerifyReportButton appointmentId={a.id} />
                        <button
                          onClick={() => setViewingReportId(a.id)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#a78bfa]/40 bg-[#a78bfa]/10 px-3 py-1.5 text-xs font-semibold text-[#c4b5fd] transition hover:bg-[#a78bfa]/20 cursor-pointer"
                        >
                          View Session Summary
                        </button>
                      </>
                    )}

                    {/* Rate / already rated */}
                    {a.status === APPT_STATUS.COMPLETED && (
                      alreadyRated ? (
                        <div className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
                          <StarRating value={typeof alreadyRated === 'number' ? alreadyRated : 5} size="sm" />
                          {typeof alreadyRated === 'number' && `${alreadyRated}★ Rated`}
                          {alreadyRated === true && 'Already Rated'}
                        </div>
                      ) : (
                        <button
                          onClick={() =>
                            setRatingAppt({
                              ...a,
                              patientId:   profile.uid,
                              patientName: profile.name || profile.email || 'Patient',
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300 transition hover:bg-amber-400/20 cursor-pointer"
                        >
                          <Star className="h-3.5 w-3.5" /> Rate Doctor
                        </button>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Rate Doctor modal ── */}
      {ratingAppt && (
        <RateDoctorModal
          appointment={ratingAppt}
          onClose={() => setRatingAppt(null)}
          onSubmitted={(stars) => {
            onRated(ratingAppt.id, stars)
            setRatingAppt(null)
          }}
        />
      )}

      {/* ── AI Session Report modal ── */}
      {viewingReportId && (
        <SessionReportModal
          appointmentId={viewingReportId}
          onClose={() => setViewingReportId(null)}
        />
      )}
    </PageTransition>
  )
}

function SessionReportModal({ appointmentId, onClose }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getSessionDetail(appointmentId)
      .then((d) => {
        if (alive) {
          setDetail(d)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err.message)
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [appointmentId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="card bg-surface w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-lg font-bold text-accent">Clinical Session Summary</h3>
          <button onClick={onClose} className="text-muted hover:text-fg transition cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted text-sm">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              Loading clinical session details...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger text-center">
              Failed to load session details: {error}
            </div>
          ) : (
            <div className="space-y-6 text-sm text-fg leading-relaxed">
              {/* Metadata */}
              <div className="grid gap-3 sm:grid-cols-2 border-b border-border pb-4 text-xs text-muted">
                <div>
                  <span className="font-semibold text-faint">Attending Doctor:</span>{' '}
                  <span className="text-fg font-medium">Dr. {detail.doctor_name}</span>
                </div>
                <div>
                  <span className="font-semibold text-faint">Completed At:</span>{' '}
                  <span className="text-fg font-medium">
                    {detail.completed_at ? new Date(detail.completed_at).toLocaleString() : '—'}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-faint">Patient:</span>{' '}
                  <span className="text-fg font-medium">{detail.patient_name}</span>
                </div>
                <div>
                  <span className="font-semibold text-faint">Appointment ID:</span>{' '}
                  <span className="text-fg font-mono">{detail.appointment_id}</span>
                </div>
              </div>

              {/* Session Notes */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-accent mb-1.5">Session Notes</h4>
                <div className="rounded-lg border border-border bg-surface-2 p-4 whitespace-pre-wrap">
                  {detail.session_notes || 'No notes recorded.'}
                </div>
              </div>

              {/* Diagnosis */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-accent mb-1.5">Diagnosis</h4>
                <div className="rounded-lg border border-border bg-surface-2 p-4 whitespace-pre-wrap font-medium">
                  {detail.diagnosis || 'No diagnosis recorded.'}
                </div>
              </div>

              {/* Prescriptions */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-accent mb-1.5">Prescriptions</h4>
                <div className="rounded-lg border border-border bg-surface-2 p-4 whitespace-pre-wrap font-mono text-xs">
                  {detail.prescriptions || 'No prescriptions recorded.'}
                </div>
              </div>

              {/* Emotional Summary (AI Insights) */}
              {detail.emotion_summary && (
                <div className="border-t border-border pt-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-success">AI Emotional Insights</h4>
                  <div className="grid gap-3 rounded-lg border border-success/20 bg-success-soft p-4 text-xs text-success">
                    {detail.emotion_summary.text_summary && (
                      <div>
                        <span className="font-semibold text-success">Text Sentiment:</span>{' '}
                        {detail.emotion_summary.text_summary}
                      </div>
                    )}
                    {detail.emotion_summary.facial_summary && (
                      <div>
                        <span className="font-semibold text-success">Facial Emotion:</span>{' '}
                        {detail.emotion_summary.facial_summary}
                      </div>
                    )}
                    {detail.emotion_summary.patterns && (
                      <div>
                        <span className="font-semibold text-success">Dominant Patterns:</span>{' '}
                        {detail.emotion_summary.patterns}
                      </div>
                    )}
                    {detail.emotion_summary.risk_summary && (
                      <div className="mt-1 border-t border-success/20 pt-2 font-medium">
                        <span className="font-semibold text-success">Risk Assessment:</span>{' '}
                        {detail.emotion_summary.risk_summary}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Cryptographic Signature details */}
              <div className="border-t border-border pt-4 text-[10px] text-faint space-y-1">
                <div className="flex items-center gap-1 text-success font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5" /> Cryptographically Verified
                </div>
                <div>Signed by Dr. {detail.doctor_name} with RSA-2048 key-pair.</div>
                {detail.pdf_sha256 && (
                  <div className="font-mono truncate">PDF Hash (SHA-256): {detail.pdf_sha256}</div>
                )}
                {detail.signature && (
                  <div className="font-mono truncate">Signature: {detail.signature}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border px-6 py-4 bg-surface-2">
          <button
            onClick={onClose}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-bold text-accent-fg hover:bg-accent/90 transition cursor-pointer"
          >
            Close Summary
          </button>
        </div>
      </motion.div>
    </div>
  )
}
