import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  doc,
  getDoc,
} from 'firebase/firestore'
import AgoraRTC from 'agora-rtc-sdk-ng'
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  PhoneOff,
  Loader2,
  AlertTriangle,
  MessageSquare,
  X,
  Send,
  FileSignature,
  ShieldCheck,
  Stethoscope,
  User,
  CheckCircle2,
  Sparkles,
  Lock,
} from 'lucide-react'
import { db } from '../lib/firebase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getRtcToken, completeSession, getPatientClinicalSummary } from '../lib/api.js'
import { setAppointmentStatus, APPT_STATUS } from '../lib/appointments.js'
import { dashboardPathFor } from '../lib/roles.js'

/**
 * VideoConsultation — the live telehealth room.
 *
 * Doctor flow  → "End & Sign Report" → stop video → sign form → generate PDF → dashboard
 * Patient flow → "Leave Session"     → stop video → mark completed              → dashboard
 *
 * Both parties have a real-time chat panel powered by Firestore subcollections.
 */
export default function VideoConsultation() {
  const { appointmentId } = useParams()
  const { role, user, profile } = useAuth()
  const navigate = useNavigate()
  const isDoctor = role === 'doctor'

  // Accent colour per role
  const accent = isDoctor ? '#00ffd5' : '#a78bfa'
  const accentDark = isDoctor ? '#0a0a0f' : '#1a0533'

  // ── Video state ────────────────────────────────────────────────────────────
  const [status, setStatus] = useState('connecting') // connecting | live | signing | done | error
  const [error, setError] = useState('')
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [remoteUsers, setRemoteUsers] = useState([])
  const [appointment, setAppointment] = useState(null)
  const [expiryCountdown, setExpiryCountdown] = useState(null)

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const chatBottomRef = useRef(null)
  const [unread, setUnread] = useState(0)
  // The chat subscription is kept stable (keyed only on appointmentId), so it
  // must read the latest "is the panel open?" and "how many messages did we last
  // see?" via refs rather than stale closure values — otherwise the unread badge
  // over-counts (every snapshot diffed against a frozen 0).
  const chatOpenRef = useRef(false)
  const seenMsgCountRef = useRef(0)

  // ── Doctor sign-form state ─────────────────────────────────────────────────
  const [sigNotes, setSigNotes] = useState('')
  const [sigDiagnosis, setSigDiagnosis] = useState('')
  const [sigPrescriptions, setSigPrescriptions] = useState('')
  const [sigBusy, setSigBusy] = useState(false)
  const [sigError, setSigError] = useState('')

  // ── Patient Info Sidebar state (Doctor Only) ───────────────────────────────
  const [infoOpen, setInfoOpen] = useState(false)
  const [patientSummary, setPatientSummary] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState('')

  // Fetch patient medical summary (CBT, journals, mood trends, past sessions)
  useEffect(() => {
    if (!infoOpen || !appointmentId || !isDoctor) return
    let alive = true
    setLoadingSummary(true)
    setSummaryError('')

    getPatientClinicalSummary(appointmentId)
      .then((data) => {
        if (alive) {
          setPatientSummary(data)
          setLoadingSummary(false)
        }
      })
      .catch((err) => {
        if (alive) {
          setSummaryError(err.message || 'Failed to load patient summary.')
          setLoadingSummary(false)
        }
      })

    return () => {
      alive = false
    }
  }, [infoOpen, appointmentId, isDoctor])

  // ── Agora refs (stable across re-renders) ─────────────────────────────────
  const clientRef = useRef(null)
  const micTrackRef = useRef(null)
  const camTrackRef = useRef(null)
  const localVideoRef = useRef(null)
  const cleanupRef = useRef(false)
  const mockStreamRef = useRef(null)

  const goHome = useCallback(
    () => navigate(dashboardPathFor(role), { replace: true }),
    [navigate, role],
  )

  // ── Idempotent teardown — always clears camera light ─────────────────────
  const teardown = useCallback(async () => {
    try {
      micTrackRef.current?.stop()
      micTrackRef.current?.close()
      camTrackRef.current?.stop()
      camTrackRef.current?.close()
    } catch { /* already closed */ }
    micTrackRef.current = null
    camTrackRef.current = null

    // Clean up mock stream
    try {
      if (mockStreamRef.current) {
        mockStreamRef.current.getTracks().forEach((track) => track.stop())
        mockStreamRef.current = null
      }
    } catch (e) {
      console.warn('Failed to stop mock tracks:', e)
    }

    // Clear the local video element so the green camera indicator goes away
    if (localVideoRef.current) {
      localVideoRef.current.innerHTML = ''
    }

    try {
      const client = clientRef.current
      if (client) {
        client.removeAllListeners()
        await client.leave()
        clientRef.current = null
      }
    } catch { /* already left */ }
  }, [])

  // ── Join Agora channel on mount ───────────────────────────────────────────
  useEffect(() => {
    cleanupRef.current = false

    async function join() {
      try {
        // 1. Load appointment
        const snap = await getDoc(doc(db, 'appointments', appointmentId))
        if (!snap.exists()) throw new Error('Appointment not found.')
        const appt = { id: snap.id, ...snap.data() }
        setAppointment(appt)
        const channelName = appt.channelName
        if (!channelName) throw new Error('This appointment has no video channel.')

        // 2. Get RTC token from backend
        let rtcData
        let token, app_id, uid
        try {
          rtcData = await getRtcToken(appointmentId, { role: 'publisher' })
          token = rtcData.token
          app_id = rtcData.app_id
          uid = rtcData.uid
        } catch (err) {
          console.warn('Could not fetch RTC token from backend. Falling back to mock mode.', err)
          app_id = 'your-agora-app-id'
        }

        if (cleanupRef.current) return

        // Check for placeholder keys to trigger mock consultation room
        if (!app_id || app_id === 'your-agora-app-id' || app_id.includes('your-agora')) {
          console.log('Agora App ID is default placeholder. Activating Mock Consultation Room.')

          // Try to get user media for local video feed
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            if (cleanupRef.current) {
              stream.getTracks().forEach((track) => track.stop())
              return
            }
            mockStreamRef.current = stream
            if (localVideoRef.current) {
              localVideoRef.current.innerHTML = ''
              const videoEl = document.createElement('video')
              videoEl.srcObject = stream
              videoEl.autoplay = true
              videoEl.playsInline = true
              videoEl.muted = true
              videoEl.className = 'h-full w-full object-cover rounded-xl'
              localVideoRef.current.appendChild(videoEl)
            }
          } catch (err) {
            console.error('Mock camera setup failed', err)
          }

          if (cleanupRef.current) return
          setStatus('live')

          // Simulate remote user joining after 1.5 seconds
          setTimeout(() => {
            if (!cleanupRef.current) {
              setRemoteUsers([{ uid: 'mock-peer-id', isMock: true }])
            }
          }, 1500)
          return
        }

        // 3. Build Agora client & wire events
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
        clientRef.current = client

        client.on('user-published', async (remoteUser, mediaType) => {
          await client.subscribe(remoteUser, mediaType)
          if (mediaType === 'audio') remoteUser.audioTrack?.play()
          setRemoteUsers((prev) => {
            const others = prev.filter((u) => u.uid !== remoteUser.uid)
            return [...others, remoteUser]
          })
        })
        client.on('user-unpublished', () => {
          // Re-render without the stale video frame
          setRemoteUsers((prev) => [...prev])
        })
        client.on('user-left', (remoteUser) => {
          setRemoteUsers((prev) => prev.filter((u) => u.uid !== remoteUser.uid))
        })

        client.on('token-privilege-will-expire', async () => {
          console.log('[video] token privilege will expire, renewing token...')
          try {
            const rtcData = await getRtcToken(appointmentId, { role: 'publisher' })
            await client.renewToken(rtcData.token)
            console.log('[video] token successfully renewed')
          } catch (err) {
            console.error('[video] failed to renew token on will-expire:', err)
          }
        })

        client.on('token-privilege-did-expire', async () => {
          console.log('[video] token privilege did expire, fetching fresh token and reconnecting...')
          try {
            const rtcData = await getRtcToken(appointmentId, { role: 'publisher' })
            await client.renewToken(rtcData.token)
            console.log('[video] token successfully renewed after expiry')
          } catch (err) {
            console.error('[video] failed to renew token on did-expire:', err)
          }
        })

        // 4. Join channel
        await client.join(app_id, channelName, token, uid || null)
        if (cleanupRef.current) {
          await teardown()
          return
        }

        // 5. Publish local tracks
        const [micTrack, camTrack] = await AgoraRTC.createMicrophoneAndCameraTracks()
        micTrackRef.current = micTrack
        camTrackRef.current = camTrack
        if (cleanupRef.current) {
          await teardown()
          return
        }

        await client.publish([micTrack, camTrack])
        if (localVideoRef.current) camTrack.play(localVideoRef.current)
        setStatus('live')
      } catch (err) {
        await teardown()
        if (cleanupRef.current) return
        console.error('[video] join failed', err)
        setError(friendlyError(err))
        setStatus('error')
      }
    }

    join()
    return () => {
      cleanupRef.current = true
      teardown()
    }
  }, [appointmentId, teardown])

  // ── Play remote video whenever the user set changes ───────────────────────
  useEffect(() => {
    for (const u of remoteUsers) {
      if (u.videoTrack) {
        const el = document.getElementById(`remote-${u.uid}`)
        if (el) u.videoTrack.play(el)
      }
    }
  }, [remoteUsers])

  // Mirror chatOpen into a ref the stable chat subscription can read.
  useEffect(() => {
    chatOpenRef.current = chatOpen
  }, [chatOpen])

  // ── Live-subscribe to consultation chat ───────────────────────────────────
  useEffect(() => {
    const msgsRef = collection(db, 'appointments', appointmentId, 'messages')
    const q = query(msgsRef, orderBy('timestamp', 'asc'))
    return onSnapshot(q, (snap) => {
      const newMsgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setMessages(newMsgs)
      // Count only genuinely-new messages, and only while the panel is closed.
      const newlyArrived = newMsgs.length - seenMsgCountRef.current
      if (!chatOpenRef.current && newlyArrived > 0) {
        setUnread((prev) => prev + newlyArrived)
      }
      // When the panel is open the user is "caught up"; either way, record the
      // count we've now accounted for so the next snapshot diffs correctly.
      seenMsgCountRef.current = newMsgs.length
    })
  }, [appointmentId]) // intentionally stable; live values read via refs

  // ── Live-subscribe to appointment status to handle automatic teardown ─────
  useEffect(() => {
    if (!appointmentId) return
    const docRef = doc(db, 'appointments', appointmentId)
    return onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        // If the appointment status changes to completed, automatically end the session for the local user.
        if (data.status === 'completed' && status !== 'done' && status !== 'signing') {
          console.log('Session was marked completed. Cleaning up media and exiting.')
          cleanupRef.current = true
          teardown().then(() => {
            if (role === 'doctor') {
              setStatus('signing')
            } else {
              goHome()
            }
          })
        }
        // Handle session expiration
        if (data.status === 'expired' && status !== 'done' && status !== 'signing') {
          console.log('Session expired. Cleaning up media and exiting.')
          cleanupRef.current = true
          teardown().then(() => {
            setError('This session has expired because the patient did not join in time.')
            setStatus('error')
          })
        }
      }
    })
  }, [appointmentId, role, goHome, teardown, status])

  // ── Expiration & Warning timer inside the room ─────────────────────────────
  useEffect(() => {
    if (status !== 'live' || !appointment?.dateTime) return

    const scheduledTime = new Date(appointment.dateTime).getTime()
    const timer = setInterval(async () => {
      const now = Date.now()
      const expiryTime = scheduledTime + 15 * 60 * 1000
      const remainingSec = Math.floor((expiryTime - now) / 1000)

      if (remoteUsers.length === 0) {
        if (remainingSec <= 0) {
          clearInterval(timer)
          console.log('Session grace period expired. Tearing down.')
          cleanupRef.current = true
          await teardown()
          try {
            await setAppointmentStatus(appointmentId, 'expired')
          } catch (e) {
            console.error('Failed to set expired status', e)
          }
          setError('Session expired. The other participant did not join in time.')
          setStatus('error')
        } else if (remainingSec <= 15 * 60) {
          // Inside grace window, show warning
          setExpiryCountdown(remainingSec)
        } else {
          setExpiryCountdown(null)
        }
      } else {
        // Peer joined
        setExpiryCountdown(null)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [status, appointment?.dateTime, remoteUsers.length, appointmentId, teardown])

  // ── Auto-scroll chat to bottom ────────────────────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Clear unread badge when opening
  const openChat = () => {
    setChatOpen(true)
    setUnread(0)
    setInfoOpen(false) // Close info sidebar to prevent overlap
  }

  // ── Media controls ────────────────────────────────────────────────────────
  const toggleMic = async () => {
    const next = !micOn
    if (micTrackRef.current) {
      await micTrackRef.current.setEnabled(next)
    } else if (mockStreamRef.current) {
      mockStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = next
      })
    }
    setMicOn(next)
  }

  const toggleCam = async () => {
    const next = !camOn
    if (camTrackRef.current) {
      await camTrackRef.current.setEnabled(next)
    } else if (mockStreamRef.current) {
      mockStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = next
      })
    }
    setCamOn(next)
  }

  // ── PATIENT: leave immediately ────────────────────────────────────────────
  const patientLeave = async () => {
    cleanupRef.current = true
    await teardown()
    try { await setAppointmentStatus(appointmentId, APPT_STATUS.COMPLETED) } catch { /* best-effort status update */ }
    goHome()
  }

  // ── DOCTOR: stop video → show signing form ────────────────────────────────
  const doctorEndCall = async () => {
    cleanupRef.current = true
    await teardown()
    try {
      await setAppointmentStatus(appointmentId, APPT_STATUS.COMPLETED)
    } catch (err) {
      console.error('Failed to set completed status:', err)
    }
    setStatus('signing')
  }

  // ── DOCTOR: end immediately without report ───────────────────────────────
  const doctorImmediateEndCall = async () => {
    cleanupRef.current = true
    await teardown()
    try {
      await setAppointmentStatus(appointmentId, APPT_STATUS.COMPLETED)
    } catch (err) {
      console.error('Failed to set completed status:', err)
    }
    goHome()
  }

  // ── DOCTOR: submit signed report ──────────────────────────────────────────
  const doctorSubmitReport = async () => {
    if (!sigNotes.trim() && !sigDiagnosis.trim() && !sigPrescriptions.trim()) {
      setSigError('Please add at least one of: session notes, diagnosis, or prescriptions.')
      return
    }
    setSigBusy(true)
    setSigError('')
    try {
      await completeSession({
        appointmentId,
        sessionNotes: sigNotes,
        diagnosis: sigDiagnosis,
        prescriptions: sigPrescriptions,
      })
      setStatus('done')
      setTimeout(goHome, 2000)
    } catch (err) {
      setSigError(err.message)
      setSigBusy(false)
    }
  }

  // ── DOCTOR: skip signing & just end ──────────────────────────────────────
  const doctorSkipSign = async () => {
    try { await setAppointmentStatus(appointmentId, APPT_STATUS.COMPLETED) } catch { /* best-effort status update */ }
    goHome()
  }

  // ── Send chat message ─────────────────────────────────────────────────────
  const sendMessage = async (e) => {
    e?.preventDefault()
    const text = chatInput.trim()
    if (!text) return
    setChatInput('')
    try {
      const senderName = isDoctor
        ? `Dr. ${appointment?.doctorName || profile?.name || 'Doctor'}`
        : (appointment?.patientName || profile?.name || 'Patient')
      await addDoc(collection(db, 'appointments', appointmentId, 'messages'), {
        text,
        senderId: user?.uid,
        senderName,
        senderRole: role,
        timestamp: serverTimestamp(),
      })
    } catch (err) {
      console.error('[chat] send failed', err)
    }
  }

  // ── Error screen ──────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center">
        <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-warning" />
        <h1 className="mb-2 text-2xl font-bold text-fg">Couldn't start the call</h1>
        <p className="mb-6 text-muted">{error}</p>
        <button
          onClick={goHome}
          className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-fg transition hover:bg-primary-hover"
        >
          Back to Dashboard
        </button>
      </div>
    )
  }

  // ── Done / success screen ─────────────────────────────────────────────────
  if (status === 'done') {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="text-center">
          <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-success" />
          <h1 className="mb-2 text-2xl font-bold text-fg">Session Complete</h1>
          <p className="text-muted">Report signed successfully. Returning to dashboard…</p>
        </div>
      </div>
    )
  }

  // ── Doctor sign-report screen (video already torn down) ───────────────────
  if (status === 'signing') {
    return (
      <div className="flex min-h-screen items-start justify-center bg-bg px-4 py-12">
        <div className="card w-full max-w-xl rounded-2xl p-8 bg-surface border-border shadow-lg">
          {/* Header */}
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft">
              <FileSignature className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-primary">Complete & Sign Report</h1>
              <p className="text-sm text-muted">
                Session with{' '}
                <span className="font-semibold text-fg">
                  {appointment?.patientName || 'Patient'}
                </span>
              </p>
            </div>
          </div>

          {sigError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">
              {sigError}
            </div>
          )}

          {/* Notes fields */}
          <SignField
            label="Session Notes"
            value={sigNotes}
            onChange={setSigNotes}
            placeholder="Summary of the session, patient state, observations…"
            rows={5}
          />
          <SignField
            label="Diagnosis"
            value={sigDiagnosis}
            onChange={setSigDiagnosis}
            placeholder="Clinical impression / diagnosis"
            rows={3}
          />
          <SignField
            label="Prescriptions / Follow-up"
            value={sigPrescriptions}
            onChange={setSigPrescriptions}
            placeholder="Medications, dosages, next-steps…"
            rows={3}
          />

          {/* Security note */}
          <div className="mb-6 flex items-start gap-2 rounded-lg bg-primary-soft px-3 py-3 text-xs text-primary">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            These notes are AES-256 encrypted before storage. The PDF is signed with your
            RSA-2048 private key so the patient can verify authenticity.
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <button
              onClick={doctorSubmitReport}
              disabled={sigBusy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-fg transition hover:bg-primary-hover disabled:opacity-50"
            >
              {sigBusy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating Report…</>
              ) : (
                <><FileSignature className="h-4 w-4" /> Generate & Sign Report</>
              )}
            </button>
            <button
              onClick={doctorSkipSign}
              disabled={sigBusy}
              className="w-full rounded-lg border border-border py-2.5 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            >
              Skip — End Session Without Report
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Live video room ───────────────────────────────────────────────────────
  const peerLabel = isDoctor
    ? (appointment?.patientName || 'Patient')
    : `Dr. ${appointment?.doctorName || 'Doctor'}`

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header
        className="flex shrink-0 items-center justify-between px-5 py-3 border-b border-border bg-surface-2/80 backdrop-blur-md"
      >
        <div className="flex items-center gap-3">
          {isDoctor
            ? <Stethoscope className="h-5 w-5 text-primary" />
            : <User className="h-5 w-5 text-accent" />}
          <span className="font-bold text-fg">Consultation Room</span>
          <span className="hidden text-sm text-muted sm:inline">· {peerLabel}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Live badge */}
          {status === 'live' && (
            <span className="flex items-center gap-1.5 rounded-full bg-danger/15 px-3 py-1 text-xs font-semibold text-danger">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
              LIVE
            </span>
          )}
          {status === 'connecting' && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…
            </span>
          )}

          {/* Role indicator badge */}
          <span
            className={`hidden rounded-full px-3 py-1 text-xs font-semibold sm:inline ${
              isDoctor ? 'bg-primary-soft text-primary' : 'bg-accent-soft text-accent'
            }`}
          >
            {isDoctor ? '🩺 Doctor' : '👤 Patient'}
          </span>

          {/* Patient Info Toggle (Doctor Only) */}
          {isDoctor && (
            <button
              onClick={() => {
                setInfoOpen(!infoOpen)
                setChatOpen(false) // Close chat to prevent overlap
              }}
              className={`relative rounded-lg border p-2 transition hover:text-fg ${
                infoOpen
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border text-muted hover:bg-surface-2'
              }`}
              title="Toggle Patient Clinical Summary"
            >
              <Sparkles className="h-5 w-5" />
            </button>
          )}

          {/* Chat toggle */}
          <button
            onClick={chatOpen ? () => setChatOpen(false) : openChat}
            className="relative rounded-lg border border-border p-2 text-muted transition hover:bg-surface-2 hover:text-fg"
            title="Toggle chat"
          >
            <MessageSquare className="h-5 w-5" />
            {unread > 0 && !chatOpen && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ── Main area: video + optional chat ─────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Video area ───────────────────────────────────────── */}
        <div className="relative flex-1 bg-black">

          {/* Expiration Countdown Banner */}
          {expiryCountdown !== null && (
            <div className="absolute left-1/2 top-4 z-20 w-[90%] max-w-md -translate-x-1/2 rounded-xl border border-amber-500/30 bg-amber-950/80 p-3 text-center text-sm font-semibold text-amber-300 backdrop-blur-md shadow-lg flex items-center justify-center gap-2 animate-bounce">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Waiting for the {isDoctor ? 'patient' : 'doctor'} to join. Session expires in {Math.floor(expiryCountdown / 60)}:{(expiryCountdown % 60).toString().padStart(2, '0')}.
              </span>
            </div>
          )}

          {/* Remote video (full screen) */}
          {remoteUsers.length > 0 ? (
            remoteUsers[0].isMock ? (
              <div className="flex h-full w-full items-center justify-center bg-gray-950">
                <div className="text-center animate-fade-in">
                  <div
                    className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-white/5 animate-pulse"
                  >
                    {isDoctor ? (
                      <User className="h-12 w-12 text-[#a78bfa]" />
                    ) : (
                      <Stethoscope className="h-12 w-12 text-[#00ffd5]" />
                    )}
                  </div>
                  <p className="font-bold text-lg text-white">
                    {isDoctor
                      ? appointment?.patientName || 'Patient'
                      : 'Dr. ' + (appointment?.doctorName || 'Doctor')}
                  </p>
                  <p className="mt-1 text-sm text-[#00ffd5] flex items-center justify-center gap-1.5 font-semibold">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
                    Live Video Consultation Room
                  </p>
                </div>
              </div>
            ) : (
              <div
                id={`remote-${remoteUsers[0].uid}`}
                className="h-full w-full"
              />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="text-center">
                <div
                  className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full"
                  style={{ background: `${accent}15` }}
                >
                  {isDoctor
                    ? <User className="h-10 w-10" style={{ color: accent }} />
                    : <Stethoscope className="h-10 w-10" style={{ color: accent }} />}
                </div>
                <p className="font-semibold text-white/70">{peerLabel}</p>
                <p className="mt-1 text-sm text-white/40">
                  {status === 'live' ? 'Waiting to join the room…' : 'Setting up your connection…'}
                </p>
              </div>
            </div>
          )}

          {/* Local video — picture-in-picture */}
          <div className="absolute bottom-24 right-4 z-20 h-32 w-44 overflow-hidden rounded-xl border-2 border-white/20 bg-gray-900 shadow-2xl sm:h-36 sm:w-48">
            <div ref={localVideoRef} className="h-full w-full" />
            {!camOn && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <VideoOff className="h-7 w-7 text-white/40" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 px-2 py-1">
              <span className="text-[10px] text-white/70">You</span>
            </div>
          </div>

          {/* ── Control bar ─────────────────────────────────────── */}
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-6 py-5">
            {/* Mic */}
            <ControlBtn
              active={micOn}
              onClick={toggleMic}
              On={Mic}
              Off={MicOff}
              label={micOn ? 'Mute' : 'Unmute'}
            />
            {/* Camera */}
            <ControlBtn
              active={camOn}
              onClick={toggleCam}
              On={VideoIcon}
              Off={VideoOff}
              label={camOn ? 'Stop Video' : 'Start Video'}
            />

            {/* Role-specific leave button */}
            {isDoctor ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={doctorEndCall}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-6 py-3 font-semibold text-white shadow-lg transition hover:bg-amber-400 active:scale-95 cursor-pointer"
                >
                  <FileSignature className="h-5 w-5" />
                  <span className="hidden sm:inline">End &amp; Sign Report</span>
                  <span className="sm:hidden">End &amp; Sign</span>
                </button>
                <button
                  onClick={doctorImmediateEndCall}
                  className="inline-flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 font-semibold text-white shadow-lg transition hover:bg-red-400 active:scale-95 cursor-pointer"
                >
                  <PhoneOff className="h-5 w-5" />
                  <span className="hidden sm:inline">End Video Call</span>
                  <span className="sm:hidden">End Call</span>
                </button>
              </div>
            ) : (
              <button
                onClick={patientLeave}
                className="inline-flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 font-semibold text-white shadow-lg transition hover:bg-red-400 active:scale-95 cursor-pointer"
              >
                <PhoneOff className="h-5 w-5" />
                <span className="hidden sm:inline">Leave Session</span>
                <span className="sm:hidden">Leave</span>
              </button>
            )}
          </div>

          {/* Role-specific info strip (doctor only) */}
          {isDoctor && status === 'live' && (
            <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200">
              <Stethoscope className="h-3.5 w-3.5" />
              Click "End &amp; Sign Report" to complete the session
            </div>
          )}
        </div>

        {/* ── Chat sidebar ─────────────────────────────────────── */}
        {chatOpen && (
          <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-surface sm:w-80">
            {/* Chat header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" style={{ color: isDoctor ? 'var(--primary)' : 'var(--accent)' }} />
                <h3 className="text-sm font-semibold text-fg">Session Chat</h3>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="rounded-lg p-1 text-muted transition hover:bg-surface-2 hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <div className="pt-8 text-center text-xs text-faint">
                  No messages yet. Say hello!
                </div>
              )}
              {messages.map((m) => {
                const mine = m.senderId === user?.uid
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow ${
                        mine ? 'rounded-br-sm' : 'rounded-bl-sm bg-surface-2 text-fg'
                      }`}
                      style={mine ? { background: isDoctor ? 'var(--primary)' : 'var(--accent)', color: isDoctor ? 'var(--primary-fg)' : 'var(--accent-fg)' } : {}}
                    >
                      <div
                        className="mb-0.5 text-[10px] font-semibold"
                        style={{ opacity: 0.6 }}
                      >
                        {m.senderName}
                      </div>
                      <div className="break-words leading-relaxed">{m.text}</div>
                    </div>
                  </div>
                )
              })}
              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <form
              onSubmit={sendMessage}
              className="flex gap-2 border-t border-border p-3"
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message…"
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-primary placeholder:text-muted/50 bg-surface"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="rounded-lg px-3 py-2 font-semibold transition disabled:opacity-40"
                style={{ background: isDoctor ? 'var(--primary)' : 'var(--accent)', color: isDoctor ? 'var(--primary-fg)' : 'var(--accent-fg)' }}
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </aside>
        )}

        {/* ── Patient Info Sidebar (Doctor Only) ─────────────────────────────────── */}
        {infoOpen && isDoctor && (
          <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-surface sm:w-80 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-primary">Patient Profile &amp; History</h3>
              </div>
              <button
                onClick={() => setInfoOpen(false)}
                className="rounded-lg p-1 text-muted transition hover:bg-primary-soft hover:text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {loadingSummary ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted text-xs">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  Loading patient medical summary...
                </div>
              ) : summaryError ? (
                summaryError.toLowerCase().includes('consent') || summaryError.includes('403') ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft text-warning mb-3">
                      <Lock className="h-6 w-6" />
                    </div>
                    <h5 className="font-bold text-fg mb-1 text-sm">Consent Pending</h5>
                    <p className="text-muted leading-relaxed text-[11px] max-w-[200px]">
                      The patient has not yet consented to share their mental health records for this consultation.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger text-center">
                    {summaryError}
                  </div>
                )
              ) : !patientSummary ? (
                <div className="text-center text-xs text-faint py-10">No summary loaded.</div>
              ) : (
                <div className="space-y-6 text-xs text-fg/80">
                  {/* Recent Mood Logs */}
                  <div>
                    <h4 className="font-bold text-primary mb-2 uppercase tracking-wider text-[10px]">Recent Mood Logs</h4>
                    {patientSummary.sharing?.mood === false ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-2 p-2.5 text-muted italic text-[11px]">
                        <Lock className="h-3.5 w-3.5 text-warning shrink-0" /> Patient has restricted sharing for mood trends.
                      </div>
                    ) : patientSummary.mood_entries?.length === 0 ? (
                      <p className="text-muted italic">No mood logs tracked yet.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {patientSummary.mood_entries.slice(0, 10).map((m, idx) => (
                          <div key={idx} className="flex justify-between items-center rounded-lg border border-border bg-surface-2 p-2">
                            <span className="font-semibold text-fg">{m.dominantEmotion}</span>
                            <span className="text-[10px] text-muted">{new Date(m.ts).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Journal Reflections */}
                  <div>
                    <h4 className="font-bold text-primary mb-2 uppercase tracking-wider text-[10px]">Recent Journal Reflections</h4>
                    {patientSummary.sharing?.journal === false ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-2 p-2.5 text-muted italic text-[11px]">
                        <Lock className="h-3.5 w-3.5 text-warning shrink-0" /> Patient has restricted sharing for journals.
                      </div>
                    ) : patientSummary.journals?.length === 0 ? (
                      <p className="text-muted italic">No journal entries found.</p>
                    ) : (
                      <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                        {patientSummary.journals.map((j, idx) => (
                          <div key={idx} className="rounded-lg border border-border bg-surface-2 p-2.5">
                            <div className="flex justify-between items-center font-bold text-fg mb-1">
                              <span className="truncate max-w-[70%]">{j.title || 'Untitled'}</span>
                              <span className="text-[9px] bg-primary-soft text-primary px-1.5 py-0.5 rounded capitalize shrink-0">{j.topic}</span>
                            </div>
                            <p className="text-muted line-clamp-3">{j.content}</p>
                            <div className="text-[9px] text-faint mt-1.5">{new Date(j.ts).toLocaleDateString()}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* CBT Worksheets */}
                  <div>
                    <h4 className="font-bold text-primary mb-2 uppercase tracking-wider text-[10px]">Completed CBT Worksheets</h4>
                    {patientSummary.sharing?.cbt === false ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-2 p-2.5 text-muted italic text-[11px]">
                        <Lock className="h-3.5 w-3.5 text-warning shrink-0" /> Patient has restricted sharing for CBT worksheets.
                      </div>
                    ) : patientSummary.cbt_exercises?.length === 0 ? (
                      <p className="text-muted italic">No CBT exercises completed yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                        {patientSummary.cbt_exercises.map((c, idx) => {
                          const date = c.ts ? new Date(c.ts).toLocaleDateString() : '—'
                          return (
                            <div key={idx} className="rounded-lg border border-border bg-surface-2 p-2.5">
                              <div className="font-bold text-fg capitalize mb-1">{c.type.replace('_', ' ')} Worksheet</div>
                              {c.type === 'anxiety' && (
                                <div className="space-y-0.5 text-muted">
                                  <div><strong>Trigger:</strong> {c.data?.trigger}</div>
                                  <div><strong>Coping Plan:</strong> {c.data?.copingPlan}</div>
                                </div>
                              )}
                              {c.type === 'reframing' && (
                                <div className="space-y-0.5 text-muted">
                                  <div><strong>ANT:</strong> {c.data?.ant}</div>
                                  <div><strong>Reframed:</strong> {c.data?.balancedThought}</div>
                                </div>
                              )}
                              {c.type === 'stress' && (
                                <div className="space-y-0.5 text-muted">
                                  <div><strong>Stressor:</strong> {c.data?.stressor}</div>
                                  <div><strong>Action Steps:</strong> {c.data?.actions}</div>
                                </div>
                              )}
                              {c.type === 'gratitude' && (
                                <div className="space-y-0.5 text-muted">
                                  <div><strong>Appreciated:</strong> {c.data?.item1}</div>
                                </div>
                              )}
                              {c.type === 'reflection' && (
                                <div className="space-y-0.5 text-muted">
                                  <div><strong>Small Win:</strong> {c.data?.proudOf}</div>
                                </div>
                              )}
                              <div className="text-[9px] text-faint mt-1">{date}</div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Past Session Summaries */}
                  <div>
                    <h4 className="font-bold text-primary mb-2 uppercase tracking-wider text-[10px]">Past Clinical Session Summaries</h4>
                    {patientSummary.past_sessions?.length === 0 ? (
                      <p className="text-muted italic">No past sessions found.</p>
                    ) : (
                      <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                        {patientSummary.past_sessions.map((ps, idx) => (
                          <div key={idx} className="rounded-lg border border-border bg-surface-2 p-2.5 space-y-1">
                            <div className="font-bold text-fg font-semibold">Dr. {ps.doctor_name}</div>
                            <div className="text-[9px] text-muted">{ps.completed_at ? new Date(ps.completed_at).toLocaleString() : '—'}</div>
                            {ps.diagnosis && <div><strong>Diagnosis:</strong> <span className="text-fg/80">{ps.diagnosis}</span></div>}
                            {ps.prescriptions && <div><strong>Prescriptions:</strong> <span className="text-fg/80">{ps.prescriptions}</span></div>}
                            {ps.session_notes && <div><strong>Notes:</strong> <span className="text-muted line-clamp-3">{ps.session_notes}</span></div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ControlBtn({ active, onClick, On, Off, label }) {
  const Icon = active ? On : Off
  return (
    <button
      onClick={onClick}
      title={label}
      className={`inline-flex h-12 w-12 items-center justify-center rounded-full border-2 transition active:scale-95 ${
        active
          ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
          : 'border-red-400/50 bg-red-500/15 text-red-300 hover:bg-red-500/25'
      }`}
    >
      <Icon className="h-5 w-5" />
    </button>
  )
}

function SignField({ label, value, onChange, placeholder, rows }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-medium text-fg/80">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none transition focus:border-primary placeholder:text-muted/50"
      />
    </div>
  )
}

function friendlyError(err) {
  const msg = String(err?.message || err)
  if (err?.name === 'NotAllowedError' || /permission/i.test(msg))
    return 'Camera/microphone permission was denied. Please allow access and retry.'
  if (/Token request failed \(503\)/.test(msg))
    return 'Video service is not configured on the server (missing Agora credentials).'
  if (/Token request failed/.test(msg))
    return 'Could not get a video token from the server. Is the backend running?'
  return msg
}
