import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase.js'

/**
 * Join the waitlist for a specific doctor's slot.
 */
export async function joinWaitlist({ patient, doctorId, doctorName, dateTime }) {
  const ref = await addDoc(collection(db, 'waitlist'), {
    patientId: patient.uid,
    patientName: patient.name || patient.email || 'Patient',
    patientEmail: patient.email || '',
    doctorId,
    doctorName,
    dateTime,
    joinedAt: serverTimestamp(),
    status: 'waiting', // 'waiting' | 'notified' | 'booked' | 'dismissed'
    notified: false,
  })
  return ref.id
}

/**
 * Check if the patient is already waitlisted for this specific slot.
 */
export async function checkWaitlistStatus(patientId, doctorId, dateTime) {
  const q = query(
    collection(db, 'waitlist'),
    where('patientId', '==', patientId),
    where('doctorId', '==', doctorId),
    where('dateTime', '==', dateTime),
    where('status', '==', 'waiting')
  )
  const snap = await getDocs(q)
  return !snap.empty
}

/**
 * Trigger notification for the first person in line on the waitlist for a slot.
 */
export async function notifyNextInWaitlist(doctorId, dateTime) {
  try {
    const q = query(
      collection(db, 'waitlist'),
      where('doctorId', '==', doctorId),
      where('dateTime', '==', dateTime),
      where('status', '==', 'waiting'),
      orderBy('joinedAt', 'asc')
    )
    const snap = await getDocs(q)
    if (!snap.empty) {
      const first = snap.docs[0]
      await updateDoc(doc(db, 'waitlist', first.id), {
        status: 'notified',
        notified: true,
        notifiedAt: serverTimestamp(),
      })
      console.log(`[waitlist] Notified patient ${first.data().patientName} for slot ${dateTime}`)
      return first.id
    }
  } catch (err) {
    console.error('[waitlist] Error notifying next in waitlist:', err)
  }
  return null
}
