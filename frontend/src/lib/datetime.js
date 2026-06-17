/** Date/time helpers for the scheduling UI. */

/** Today as YYYY-MM-DD (local), for an <input type="date"> min attribute. */
export function todayISODate() {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

/** Half-hour slot labels across a working day, e.g. "09:00" … "16:30". */
export function dayTimeSlots(startHour = 9, endHour = 17, stepMin = 30) {
  const slots = []
  for (let m = startHour * 60; m < endHour * 60; m += stepMin) {
    const h = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    slots.push(`${h}:${mm}`)
  }
  return slots
}

/** Combine a "YYYY-MM-DD" date and "HH:MM" slot into a local Date. */
export function combineDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`)
}

/** Human-friendly rendering of a stored ISO datetime. */
export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** True once the stored datetime is in the past. */
export function isPast(iso) {
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now()
}
