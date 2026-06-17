/**
 * Doctor rating system — Firestore-backed.
 *
 * Collections:
 *   ratings/{reviewId}         — individual patient reviews
 *   doctor_ratings/{doctorId}  — pre-computed aggregate { avgRating, ratingCount }
 *
 * The aggregate is updated atomically via a Firestore transaction each time a
 * new review is submitted so the patient's picker always shows a live average.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db } from './firebase.js'

/**
 * Submit a 1–5 star rating for a doctor.
 * One rating per patient per appointment (enforced by checking Firestore).
 */
export async function submitRating({
  doctorId,
  patientId,
  patientName,
  rating,    // number 1-5
  comment,   // optional string
  appointmentId,
}) {
  // Guard: one rating per appointment
  const existing = await getDocs(
    query(
      collection(db, 'ratings'),
      where('appointmentId', '==', appointmentId),
      where('patientId', '==', patientId),
    ),
  )
  if (!existing.empty) throw new Error('You have already rated this session.')

  // Write the individual review
  await addDoc(collection(db, 'ratings'), {
    doctorId,
    patientId,
    patientName,
    rating: Number(rating),
    comment: comment?.trim() || '',
    appointmentId,
    timestamp: serverTimestamp(),
  })

  // Atomically update the aggregate average
  const aggRef = doc(db, 'doctor_ratings', doctorId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(aggRef)
    if (!snap.exists()) {
      tx.set(aggRef, { avgRating: Number(rating), ratingCount: 1 })
    } else {
      const { avgRating, ratingCount } = snap.data()
      const newCount = ratingCount + 1
      const newAvg = (avgRating * ratingCount + Number(rating)) / newCount
      tx.update(aggRef, { avgRating: newAvg, ratingCount: newCount })
    }
  })
}

/**
 * Fetch the aggregate rating for one doctor.
 * Returns { avgRating: number, ratingCount: number }.
 */
export async function getDoctorRating(doctorId) {
  const snap = await getDoc(doc(db, 'doctor_ratings', doctorId))
  if (!snap.exists()) return { avgRating: 0, ratingCount: 0 }
  return snap.data()
}

/**
 * Fetch aggregate ratings for a batch of doctors in parallel.
 * Returns a Map<doctorId, { avgRating, ratingCount }>.
 */
export async function getDoctorRatingsBatch(doctorIds) {
  const results = await Promise.all(
    doctorIds.map(async (id) => [id, await getDoctorRating(id)]),
  )
  return new Map(results)
}

/**
 * Returns true if the patient has already rated the given appointment.
 */
export async function hasRated(appointmentId, patientId) {
  const snap = await getDocs(
    query(
      collection(db, 'ratings'),
      where('appointmentId', '==', appointmentId),
      where('patientId', '==', patientId),
    ),
  )
  return !snap.empty
}
