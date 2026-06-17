import { useCallback, useEffect, useRef, useState } from 'react'
import '@tensorflow/tfjs-backend-webgl'
import '@tensorflow/tfjs-backend-cpu'

/*
 * useEmotionTracker  —  Adaptive Landmark-Based Emotion Estimator
 *
 * How real emotion detection works (real-world scenario):
 * ─────────────────────────────────────────────────────────
 * Professional systems (Google, Microsoft, Amazon) use deep CNNs trained
 * on millions of labeled face images (FER2013, AffectNet, EmotionNet).
 * They detect Facial Action Units (FACS) and classify combinations:
 *   AU6 + AU12  →  Happy (cheek raiser + lip corner puller)
 *   AU4 + AU5   →  Angry (brow lowerer + upper lid raiser)
 *   AU1 + AU15  →  Sad  (inner brow raiser + lip corner depressor)
 *   AU1+2+5+26  →  Fear (multiple brow + eye + mouth units)
 *
 * What we do here (geometry + adaptive baseline):
 * ─────────────────────────────────────────────────────────
 * 1. Get 468 face landmark points from MediaPipe FaceMesh (tfjs runtime).
 * 2. Compute mouth corner elevation, brow-eye distance, eye openness, MAR.
 * 3. During the first 2 s the system CALIBRATES to YOUR neutral face.
 * 4. All emotion scores are DEVIATIONS from your personal neutral baseline,
 *    so "resting bitch face" or naturally heavy brows don't trigger Angry.
 * 5. A slow EMA keeps the baseline adapting if lighting/pose changes.
 */

const TARGET_INTERVAL_MS = 1000 / 15
const FACE_GRACE_MS      = 600
const CALIBRATION_FRAMES = 30    // ~2 s at 15 fps
const EMA_ALPHA          = 0.015 // baseline drift speed (~4 s half-life)

const EMPTY = { Happy: 0, Sad: 0, Angry: 0, Fear: 0, Neutral: 0 }

/* ─── MediaPipe FaceMesh landmark indices ─────────────────────────────── */
const IDX = {
  MOUTH_LEFT:  61,
  MOUTH_RIGHT: 291,
  LIP_TOP:     13,
  LIP_BOT:     14,
  LE_TOP: 159, LE_BOT: 145, LE_LEFT:  33, LE_RIGHT: 133,
  RE_TOP: 386, RE_BOT: 374, RE_LEFT: 362, RE_RIGHT: 263,
  LBROW: 52,   RBROW: 282,
}

function d2(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/** Extract raw facial metrics from 468 keypoints. */
function getMetrics(keypoints, boxHeight) {
  const p     = (i) => keypoints[i]
  const scale = boxHeight || 1

  const mouthW      = d2(p(IDX.MOUTH_LEFT), p(IDX.MOUTH_RIGHT))
  const mouthH      = d2(p(IDX.LIP_TOP),    p(IDX.LIP_BOT))
  const MAR         = mouthH / Math.max(mouthW, 1)

  const lipCY       = (p(IDX.LIP_TOP).y + p(IDX.LIP_BOT).y) / 2
  const cornerY     = (p(IDX.MOUTH_LEFT).y + p(IDX.MOUTH_RIGHT).y) / 2
  const cornerElev  = (lipCY - cornerY) / scale   // +ve = corners above = smile

  const lEAR        = d2(p(IDX.LE_TOP), p(IDX.LE_BOT)) / Math.max(d2(p(IDX.LE_LEFT), p(IDX.LE_RIGHT)), 1)
  const rEAR        = d2(p(IDX.RE_TOP), p(IDX.RE_BOT)) / Math.max(d2(p(IDX.RE_LEFT), p(IDX.RE_RIGHT)), 1)
  const EAR         = (lEAR + rEAR) / 2

  const lBrow       = (p(IDX.LE_TOP).y - p(IDX.LBROW).y) / scale
  const rBrow       = (p(IDX.RE_TOP).y - p(IDX.RBROW).y) / scale
  const browDist    = (lBrow + rBrow) / 2   // +ve = brows above eyes

  return { cornerElev, EAR, browDist, MAR }
}

/**
 * Convert metric DEVIATIONS from the neutral baseline into emotion scores.
 *
 * dCorner  > 0  →  corners raised above your personal neutral  →  Happy
 * dCorner  < 0  →  corners lowered below your personal neutral →  Sad
 * dBrow    > 0  →  brows pressed closer than your neutral      →  Angry
 * dEAR     > 0  →  eyes wider than your neutral               →  part of Fear
 * MAR high      →  mouth open                                 →  part of Fear
 */
function emotionsFromDelta(metrics, baseline) {
  const { cornerElev, EAR, browDist, MAR } = metrics

  const dCorner = cornerElev  - baseline.cornerElev   // +ve = smile
  const dBrow   = baseline.browDist  - browDist       // +ve = brows pressed (angry)
  const dEAR    = EAR - baseline.EAR                  // +ve = eyes widened

  // ── Happy: corners raised relative to YOUR neutral ──
  const rawHappy = Math.max(0, dCorner * 22)

  // ── Sad: corners lowered relative to YOUR neutral ──
  const rawSad   = Math.max(0, -dCorner * 17)

  // ── Angry: brows pressed DOWN from YOUR normal position ──
  // dBrow > 0 only when browDist drops BELOW your personal baseline.
  // A person with naturally low brows scores 0 here at rest.
  const rawAngry = Math.max(0, dBrow * 14)

  // ── Fear: eyes noticeably WIDER than your normal + mouth open ──
  const rawFear  = Math.max(0, dEAR * 10)
               + Math.max(0, MAR - (baseline.MAR + 0.08)) * 5

  // ── Neutral: constant baseline so bars sum to meaningful percentages ──
  const rawNeutral = 0.28

  const total = rawHappy + rawSad + rawAngry + rawFear + rawNeutral || 1
  return {
    Happy:   rawHappy   / total,
    Sad:     rawSad     / total,
    Angry:   rawAngry   / total,
    Fear:    rawFear    / total,
    Neutral: rawNeutral / total,
  }
}

/* ─── Exponential smoothing ───────────────────────────────────────────── */
const SMOOTH = 0.30
function smoothEmotions(prev, next) {
  const out = {}
  for (const k of Object.keys(next)) out[k] = prev[k] * SMOOTH + next[k] * (1 - SMOOTH)
  return out
}

export default function useEmotionTracker(videoRef) {
  const [status,      setStatus]      = useState('idle')
  const [error,       setError]       = useState('')
  const [errorType,   setErrorType]   = useState('None')
  const [emotions,    setEmotions]    = useState(EMPTY)
  const [fps,         setFps]         = useState(0)
  const [faceVisible, setFaceVisible] = useState(false)
  const [calibrating, setCalibrating] = useState(false)

  const streamRef       = useRef(null)
  const detectorRef     = useRef(null)
  const rafRef          = useRef(null)
  const runningRef      = useRef(false)
  const lastInferRef    = useRef(0)
  const fpsWindowRef    = useRef({ count: 0, t0: 0 })
  const faceVisibleRef  = useRef(false)
  const lastFaceSeenRef = useRef(0)
  const prevEmotions    = useRef(EMPTY)
  const reconnectTimerRef = useRef(null)
  const startRef        = useRef(null)

  // ── Adaptive baseline refs ──
  const calibRef  = useRef({ frames: 0, sum: { cornerElev: 0, EAR: 0, browDist: 0, MAR: 0 } })
  const baselineRef = useRef(null)   // null until calibrated

  const resetBaseline = () => {
    calibRef.current  = { frames: 0, sum: { cornerElev: 0, EAR: 0, browDist: 0, MAR: 0 } }
    baselineRef.current = null
  }

  const stop = useCallback(() => {
    runningRef.current = false
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    faceVisibleRef.current = false
    setFaceVisible(false)
    setEmotions(EMPTY)
    prevEmotions.current = EMPTY
    setFps(0)
    setCalibrating(false)
    setStatus('idle')
    resetBaseline()
  }, [videoRef])

  const handleUnexpectedDisconnect = useCallback(() => {
    console.warn('[EmotionTracker] Camera stream ended unexpectedly. Attempting auto-recovery...')
    setError('Camera disconnected. Reconnecting in 10 seconds...')
    setErrorType('Disconnected')
    setStatus('error')

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    faceVisibleRef.current = false
    setFaceVisible(false)

    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = setTimeout(() => {
      // Only recover if the tracker is still supposed to be running (not stopped by user)
      if (runningRef.current) {
        console.log('[EmotionTracker] Recovery timer triggered. Restarting camera...')
        setError('')
        setErrorType('None')
        runningRef.current = false // reset flag so start() doesn't early return
        startRef.current?.()
      }
    }, 10000)
  }, [videoRef])

  const loop = useCallback(async () => {
    if (!runningRef.current) return
    const video    = videoRef.current
    const detector = detectorRef.current
    const now      = performance.now()
    const due      = now - lastInferRef.current >= TARGET_INTERVAL_MS

    if (due && video && video.readyState >= 2 && detector) {
      lastInferRef.current = now
      try {
        const faces = await detector.estimateFaces(video, { flipHorizontal: false })

        if (faces.length > 0) {
          faceVisibleRef.current = true
          setFaceVisible(true)
          lastFaceSeenRef.current = now

          const face    = faces[0]
          if (face.keypoints && face.keypoints.length >= 300) {
            const metrics = getMetrics(face.keypoints, face.box?.height)
            const calib   = calibRef.current
            const bl      = baselineRef.current

            if (!bl) {
              // ── Phase 1: Calibration — accumulate neutral metrics ──
              setCalibrating(true)
              calib.frames++
              for (const k of Object.keys(calib.sum)) calib.sum[k] += metrics[k]

              if (calib.frames >= CALIBRATION_FRAMES) {
                // Snap baseline to average of first N frames
                baselineRef.current = Object.fromEntries(
                  Object.keys(calib.sum).map((k) => [k, calib.sum[k] / calib.frames])
                )
                setCalibrating(false)
              }
            } else {
              // ── Phase 2: Detection — measure deviations from baseline ──
              // Slowly drift baseline to handle lighting / pose changes
              for (const k of Object.keys(bl)) {
                bl[k] = bl[k] * (1 - EMA_ALPHA) + metrics[k] * EMA_ALPHA
              }

              const raw      = emotionsFromDelta(metrics, bl)
              const smoothed = smoothEmotions(prevEmotions.current, raw)
              prevEmotions.current = smoothed
              setEmotions({ ...smoothed })

              // FPS counter
              const w = fpsWindowRef.current
              w.count++
              if (!w.t0) w.t0 = now
              if (now - w.t0 >= 1000) {
                setFps(Math.round((w.count * 1000) / (now - w.t0)))
                w.count = 0
                w.t0    = now
              }
            }
          }
        } else if (now - lastFaceSeenRef.current > FACE_GRACE_MS) {
          faceVisibleRef.current = false
          setFaceVisible(false)
          setEmotions(EMPTY)
          prevEmotions.current = EMPTY
        }
      } catch (err) {
        console.warn('[EmotionTracker] frame error:', err.message)
        if (now - lastFaceSeenRef.current > FACE_GRACE_MS) {
          faceVisibleRef.current = false
          setFaceVisible(false)
        }
      }
    }

    rafRef.current = requestAnimationFrame(loop)
  }, [videoRef])

  const start = useCallback(async () => {
    if (runningRef.current) return
    setError('')
    setErrorType('None')
    setStatus('loading')
    resetBaseline()
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    try {
      if (!detectorRef.current) {
        const tf = await import('@tensorflow/tfjs-core')
        try { await tf.setBackend('webgl') } catch { await tf.setBackend('cpu') }
        await tf.ready()

        const fld = await import('@tensorflow-models/face-landmarks-detection')
        const createDetector  = fld.createDetector  || fld.default?.createDetector
        const SupportedModels = fld.SupportedModels  || fld.default?.SupportedModels
        if (!createDetector || !SupportedModels) throw new Error('Face detection library not found.')

        detectorRef.current = await createDetector(
          SupportedModels.MediaPipeFaceMesh,
          { runtime: 'tfjs', refineLandmarks: false, maxFaces: 1 },
        )
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
      })
      streamRef.current = stream

      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.onended = () => {
          if (runningRef.current) {
            handleUnexpectedDisconnect()
          }
        }
      }

      const video = videoRef.current
      video.srcObject = stream
      await video.play()

      runningRef.current     = true
      faceVisibleRef.current = false
      lastFaceSeenRef.current = performance.now()
      prevEmotions.current   = EMPTY
      fpsWindowRef.current   = { count: 0, t0: 0 }
      lastInferRef.current   = 0
      setEmotions(EMPTY)
      setFaceVisible(false)
      setStatus('running')
      setCalibrating(true)
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      let msg = `Could not start: ${err?.message || err}`
      let type = 'UnknownError'
      if (err?.name === 'NotAllowedError') {
        msg = 'Camera access denied — allow camera in browser settings.'
        type = 'NotAllowedError'
      } else if (err?.name === 'NotFoundError') {
        msg = 'No camera found. Connect a webcam and try again.'
        type = 'NotFoundError'
      } else if (err?.name === 'NotReadableError' || err?.name === 'AbortError') {
        msg = 'Camera is already in use by another tab or app.'
        type = 'NotReadableError'
      }
      setError(msg)
      setErrorType(type)
      setStatus('error')
      stop()
    }
  }, [loop, stop, videoRef, handleUnexpectedDisconnect])

  startRef.current = start

  useEffect(() => {
    return () => {
      runningRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      if (detectorRef.current?.dispose) detectorRef.current.dispose()
    }
  }, [])

  return { status, error, errorType, emotions, fps, faceVisible, calibrating, start, stop }
}

