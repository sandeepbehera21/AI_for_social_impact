/**
 * Crisis & SOS data layer (Phase 2).
 *
 * Two patient-owned collections, both guarded by security rules:
 *   - `trusted_contacts` : a patient's emergency contact list (CRUD by owner).
 *   - `crisis_events`    : an append-only log of SOS / grounding / breathing
 *                          usage and chat-detected crises, surfaced to the
 *                          patient's doctor (read via the backend) as a
 *                          crisis-indicator on the doctor dashboard.
 *
 * Emergency hotlines are static, regional, and need no storage.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db } from './firebase.js'
import { triggerCrisisAlert } from './api.js'


/** Static crisis hotlines (mirror backend HOTLINES). */
export const HOTLINES = [
  { name: '988 Suicide & Crisis Lifeline', phone: '988', region: 'US' },
  { name: 'Crisis Text Line', phone: 'Text HOME to 741741', region: 'US' },
  { name: 'Vandrevala Foundation Helpline', phone: '1860-2662-345', region: 'IN' },
  { name: 'iCall Psychosocial Helpline', phone: '9152987821', region: 'IN' },
  {
    name: 'International Association for Suicide Prevention',
    phone: 'https://www.iasp.info/resources/Crisis_Centres/',
    region: 'Global',
  },
]

/** Guided grounding exercise (5-4-3-2-1 senses). */
export const GROUNDING_STEPS = [
  { sense: '5 things you can SEE', detail: 'Look around and name five things you can see right now.' },
  { sense: '4 things you can TOUCH', detail: 'Notice four things you can feel — your chair, the floor, your clothes.' },
  { sense: '3 things you can HEAR', detail: 'Listen for three distinct sounds around you.' },
  { sense: '2 things you can SMELL', detail: 'Find two things you can smell, or two scents you like.' },
  { sense: '1 thing you can TASTE', detail: 'Notice one thing you can taste, or take a sip of water.' },
]

/** Box-breathing cycle phases (4-4-4-4 seconds). */
export const BREATHING_PHASES = [
  { label: 'Breathe In', seconds: 4 },
  { label: 'Hold', seconds: 4 },
  { label: 'Breathe Out', seconds: 4 },
  { label: 'Hold', seconds: 4 },
]

export const CRISIS_EVENT_TYPES = {
  SOS_OPENED: 'sos_opened',
  GROUNDING: 'grounding_completed',
  BREATHING: 'breathing_completed',
  CHAT_CRISIS: 'chat_crisis',
  CONTACT_USED: 'trusted_contact_used',
}

/**
 * Append a crisis/SOS event for the patient's care record. Best-effort —
 * swallows errors so a logging failure never blocks the calming UX.
 *
 * Clinician alert is ONLY sent for high-severity types (chat_crisis) to
 * prevent over-alerting doctors on routine SOS page opens / exercises.
 */
export async function logCrisisEvent(patientId, type, detail = '') {
  if (!patientId || !type) return
  try {
    await addDoc(collection(db, 'crisis_events'), {
      patientId,
      type,
      detail: String(detail).slice(0, 500),
      ts: Date.now(),
      createdAt: serverTimestamp(),
    })
    
    // Alert the doctor only for high-severity crisis events (not page loads or exercises)
    const HIGH_SEVERITY_TYPES = [CRISIS_EVENT_TYPES.CHAT_CRISIS]
    if (HIGH_SEVERITY_TYPES.includes(type)) {
      await triggerCrisisAlert(type, detail).catch((err) => {
        console.warn('[sos] failed to trigger clinician crisis alert:', err)
      })
    }
  } catch {
    // Swallowed intentionally — crisis UX must never be blocked by logging failures
  }
}

/** Live subscription to a patient's trusted contacts. */
export function subscribeTrustedContacts(patientId, onChange, onError) {
  const q = query(collection(db, 'trusted_contacts'), where('patientId', '==', patientId))
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (a.ts || 0) - (b.ts || 0))
      onChange(list)
    },
    (err) => {
      console.error('[sos] contacts subscription error', err)
      onError?.(err)
    },
  )
}

export async function addTrustedContact(patientId, { name, phone, relationship }) {
  if (!patientId) throw new Error('You must be signed in.')
  if (!name?.trim() || !phone?.trim()) throw new Error('Name and phone are required.')
  await addDoc(collection(db, 'trusted_contacts'), {
    patientId,
    name: name.trim().slice(0, 100),
    phone: phone.trim().slice(0, 40),
    relationship: (relationship || '').trim().slice(0, 60),
    ts: Date.now(),
    createdAt: serverTimestamp(),
  })
}

export async function removeTrustedContact(contactId) {
  await deleteDoc(doc(db, 'trusted_contacts', contactId))
}

export const CRISIS_EVENT_LABELS = {
  sos_opened: 'Opened SOS Center',
  grounding_completed: 'Completed grounding exercise',
  breathing_completed: 'Completed breathing exercise',
  chat_crisis: 'Crisis detected in chat',
  trusted_contact_used: 'Reached out to a trusted contact',
}
