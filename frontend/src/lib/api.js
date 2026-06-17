import { auth } from './firebase.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
const WS_URL =
  import.meta.env.VITE_WS_URL || API_URL.replace(/^http(s?):\/\//, 'ws$1://')

export { API_URL }

/**
 * Convert the tracker's FER+ vector {Happy,Sad,Angry,Fear,Neutral} into the
 * backend's `facial_emotion` shape {happy,sad,angry,fear,neutral}. Returns null
 * when the camera is off / there's no signal, so the field is simply omitted.
 */
function toFacialEmotion(facial) {
  if (!facial) return null
  const happy = facial.Happy || 0
  const sad = facial.Sad || 0
  const angry = facial.Angry || 0
  const fear = facial.Fear || 0
  const neutral = facial.Neutral || 0
  if (happy + sad + angry + fear + neutral <= 0) return null
  return { happy, sad, angry, fear, neutral }
}

/**
 * One-shot REST chat (fallback for when the WebSocket isn't available).
 * Optionally fuses a live facial-emotion snapshot. A `sessionId` keeps replies
 * context-aware across calls. Returns the full payload:
 *   { type, response, analysis, hotlines?, book_consultation_route? }
 * Throws on network or non-2xx responses.
 */
export async function sendChatMessage(message, facial, sessionId, patientId) {
  const body = { message }
  const facialEmotion = toFacialEmotion(facial)
  if (facialEmotion) body.facial_emotion = facialEmotion
  // A session id keeps the REST fallback context-aware across turns, matching
  // the WebSocket path (which keeps context per-connection automatically).
  if (sessionId) body.session_id = sessionId
  if (patientId) body.patient_id = patientId

  const headers = { 'Content-Type': 'application/json' }
  const user = auth.currentUser
  if (user) {
    try {
      const token = await user.getIdToken()
      headers.Authorization = `Bearer ${token}`
    } catch (err) {
      console.warn('[api] Failed to fetch ID token for REST chat:', err)
    }
  }

  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let detail = `Server responded ${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) detail = data.detail
    } catch {
      /* response had no JSON body */
    }
    throw new Error(detail)
  }

  return res.json()
}

/**
 * Open a real-time chat WebSocket with automatic reconnection.
 *
 * The previous implementation connected once and did nothing on error, so a
 * single transient failure (backend cold-start, a uvicorn --reload, a network
 * blip) left a permanently-dead socket while the browser logged
 * "WebSocket connection ... failed" and every send silently fell back to REST.
 *
 * This version reconnects with capped exponential backoff and reports state
 * changes via `onStatus(state)` where state is one of:
 *   'connecting' | 'open' | 'closed' | 'reconnecting'
 *
 * Returns a controller: { send(message, facial, sessionId), close(), get ready() }.
 * Callbacks: onMessage(payload), onOpen(), onClose(), onError(err), onStatus(state).
 */
export function createChatSocket({
  onMessage,
  onOpen,
  onClose,
  onError,
  onStatus,
} = {}) {
  let ws = null
  let closedByUser = false
  let retries = 0
  let reconnectTimer = null

  const status = (s) => onStatus?.(s)

  const connect = async () => {
    status(retries === 0 ? 'connecting' : 'reconnecting')
    let tokenParam = ''
    try {
      const user = auth.currentUser
      if (user) {
        const token = await user.getIdToken()
        tokenParam = `?token=${encodeURIComponent(token)}`
      }
    } catch (err) {
      console.warn('[api] Failed to get token for WebSocket connection:', err)
    }

    if (closedByUser) return

    ws = new WebSocket(`${WS_URL}/ws/chat${tokenParam}`)

    ws.onopen = () => {
      retries = 0
      status('open')
      onOpen?.()
    }
    ws.onclose = () => {
      status('closed')
      onClose?.()
      if (!closedByUser) scheduleReconnect()
    }
    ws.onerror = (e) => onError?.(e)
    ws.onmessage = (event) => {
      try {
        onMessage?.(JSON.parse(event.data))
      } catch {
        onError?.(new Error('Malformed server message'))
      }
    }
  }

  const scheduleReconnect = () => {
    if (closedByUser || reconnectTimer) return
    // 0.5s, 1s, 2s, 4s … capped at 10s.
    const delay = Math.min(10000, 500 * 2 ** retries)
    retries += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  connect()

  return {
    send: (message, facial, sessionId, patientId) => {
      const payload = { message }
      const facialEmotion = toFacialEmotion(facial)
      if (facialEmotion) payload.facial_emotion = facialEmotion
      if (sessionId) payload.session_id = sessionId
      if (patientId) payload.patient_id = patientId
      ws.send(JSON.stringify(payload))
    },
    close: () => {
      closedByUser = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    },
    get ready() {
      return ws?.readyState === WebSocket.OPEN
    },
  }
}

/** Fetch a short-lived Agora RTC token for a telehealth channel. */
export async function getRtcToken(appointmentId, { role = 'publisher', uid = 0 } = {}) {
  const params = new URLSearchParams({ appointment_id: appointmentId, role, uid })
  const res = await fetch(`${API_URL}/api/tokens/rtc?${params}`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

// ---------------------------------------------------------------------------
// Clinical (Phase 4) — all authenticated with the caller's Firebase ID token.
// ---------------------------------------------------------------------------

/** Resolve a fresh Firebase ID token for the signed-in user. */
async function authHeader() {
  const user = auth.currentUser
  if (!user) throw new Error('You must be signed in.')
  const token = await user.getIdToken()
  return { Authorization: `Bearer ${token}` }
}

/** Parse a JSON error body into a readable message. */
async function readError(res) {
  let detail = `Server responded ${res.status}`
  try {
    const data = await res.json()
    if (data?.detail) detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
  } catch {
    /* no JSON body */
  }
  return new Error(detail)
}

/**
 * Ensure the signed-in doctor has an RSA-2048 key-pair on the backend.
 * Returns { public_key, public_key_fingerprint, private_key?, created }.
 * `private_key` is non-null ONLY the first time the pair is generated.
 */
export async function ensureDoctorKeys() {
  const res = await fetch(`${API_URL}/api/doctor/keys/ensure`, {
    method: 'POST',
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/**
 * Complete + sign a clinical session (doctor only).
 * Returns { appointment_id, status, signature, pdf_sha256, report_url }.
 */
export async function completeSession({
  appointmentId,
  sessionNotes,
  diagnosis,
  prescriptions,
}) {
  const res = await fetch(`${API_URL}/api/sessions/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      appointment_id: appointmentId,
      session_notes: sessionNotes || '',
      diagnosis: diagnosis || '',
      prescriptions: prescriptions || '',
    }),
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Fetch decrypted clinical detail for an appointment (either party). */
export async function getSessionDetail(appointmentId) {
  const res = await fetch(`${API_URL}/api/sessions/${appointmentId}`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Fetch the signed clinical PDF as an ArrayBuffer (for verification/preview). */
export async function fetchSessionReport(appointmentId) {
  const res = await fetch(`${API_URL}/api/sessions/${appointmentId}/report`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.arrayBuffer()
}

/**
 * Doctor-only: aggregated mood summary for a patient the caller is treating.
 * The backend verifies an appointment exists between them before returning
 * anything. Returns { patient_id, total_samples, latest, periods: [...] }.
 */
export async function getPatientMoodSummary(patientId) {
  const res = await fetch(`${API_URL}/api/patients/${patientId}/mood-summary`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Doctor-only: fetch the patient's full clinical summary (journals, CBT, moods, past sessions) for the attending doctor. */
export async function getPatientClinicalSummary(appointmentId) {
  const res = await fetch(`${API_URL}/api/sessions/${appointmentId}/patient-summary`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/**
 * Doctor-only: aggregated wellness ecosystem for a patient the caller is
 * treating (wellness score, recommendations, habit stats, plan adherence,
 * crisis events). The backend verifies an appointment exists between them.
 */
export async function getPatientWellnessSummary(patientId) {
  const res = await fetch(`${API_URL}/api/patients/${patientId}/wellness-summary`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

// ---------------------------------------------------------------------------
// Admin (Dashboard)
// ---------------------------------------------------------------------------

/** Fetch overall platform stats. */
export async function getAdminStats() {
  const res = await fetch(`${API_URL}/api/admin/stats`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Fetch all registered users directory. */
export async function getAdminUsers() {
  const res = await fetch(`${API_URL}/api/admin/users`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Execute verification action on user account. */
export async function actionUserAccount(uid, action) {
  const res = await fetch(`${API_URL}/api/admin/action-user/${uid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Broadcast an announcement. */
export async function createBroadcast(message, type, target) {
  const res = await fetch(`${API_URL}/api/admin/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ message, type, target }),
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Stop/deactivate a broadcast. */
export async function stopBroadcast(broadcastId) {
  const res = await fetch(`${API_URL}/api/admin/broadcast/${broadcastId}/stop`, {
    method: 'POST',
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Fetch service health monitor status. */
export async function getPlatformHealth() {
  const res = await fetch(`${API_URL}/api/admin/health`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Fetch patient ratings and reviews. */
export async function getAdminFeedback() {
  const res = await fetch(`${API_URL}/api/admin/feedback`, {
    headers: { ...(await authHeader()) },
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

/** Trigger a clinician notification for all doctors treating this patient when a crisis/SOS event is logged. */
export async function triggerCrisisAlert(type, detail = '') {
  const res = await fetch(`${API_URL}/api/patients/crisis-alert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeader()),
    },
    body: JSON.stringify({ type, detail }),
  })
  if (!res.ok) throw await readError(res)
  return res.json()
}

