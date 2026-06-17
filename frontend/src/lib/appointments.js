/**
 * Firestore data access for the scheduling system.
 *
 * Collections (see firestore.rules):
 *   users        { uid, email, name, role, registrationDate }
 *   appointments { patientId, patientName, doctorId, doctorName,
 *                  dateTime, status, channelName, createdAt }
 *
 * `status` ∈ "pending" | "approved" | "completed" | "rejected".
 */
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase.js'

export const APPT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

/** Unique, Agora-safe channel name (ASCII, ≤ 64 chars) for one consultation. */
export function generateChannelName() {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `mindease-${rand}`.slice(0, 64)
}

/** One-shot fetch of every registered doctor (for the patient's picker). */
export async function listDoctors() {
  const q = query(collection(db, 'users'), where('role', '==', 'doctor'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
}

/**
 * Patient requests an appointment. Always created as "pending" with a fresh
 * channel name; the doctor approves it later.
 */
export async function requestAppointment({
  patient,
  doctor,
  dateTime, // JS Date or ISO string
}) {
  const iso = dateTime instanceof Date ? dateTime.toISOString() : dateTime
  const ref = await addDoc(collection(db, 'appointments'), {
    patientId: patient.uid,
    patientName: patient.name || patient.email || 'Patient',
    doctorId: doctor.uid,
    doctorName: doctor.name || doctor.email || 'Doctor',
    dateTime: iso,
    status: APPT_STATUS.PENDING,
    channelName: generateChannelName(),
    createdAt: serverTimestamp(),
  })
  return ref.id
}

/** Move an appointment to a new lifecycle status. */
export function setAppointmentStatus(appointmentId, status) {
  return updateDoc(doc(db, 'appointments', appointmentId), { status })
}

/**
 * Reschedule an appointment to a new datetime (doctor action). Accepts a JS
 * Date or ISO string and persists it as ISO, matching `requestAppointment`.
 */
export function rescheduleAppointment(appointmentId, dateTime) {
  const iso = dateTime instanceof Date ? dateTime.toISOString() : dateTime
  return updateDoc(doc(db, 'appointments', appointmentId), { dateTime: iso })
}

/**
 * Live subscription to a user's appointments. `field` is "patientId" or
 * "doctorId". Returns the unsubscribe fn. Results are sorted client-side by
 * dateTime so we don't require a composite Firestore index.
 */
export function subscribeAppointments(field, uid, onChange, onError) {
  const q = query(collection(db, 'appointments'), where(field, '==', uid))
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)))
      onChange(rows)
    },
    (err) => {
      console.error('[appointments] subscription error', err)
      onError?.(err)
    },
  )
}
