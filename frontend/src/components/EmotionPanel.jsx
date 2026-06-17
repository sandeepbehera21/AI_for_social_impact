import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, CameraOff, Activity, ScanFace, RefreshCw, AlertCircle } from 'lucide-react'
import useEmotionTracker from '../hooks/useEmotionTracker.js'

const ORDER = ['Happy', 'Sad', 'Angry', 'Fear', 'Neutral']
const COLORS = {
  Happy: '#22c55e',
  Sad: '#3b82f6',
  Angry: '#ef4444',
  Fear: '#a855f7',
  Neutral: '#94a3b8',
}

const EMOJIS = [
  { name: 'Happy', char: '😊', bg: 'bg-green-500/10 hover:bg-green-500/20 text-green-500 border-green-500/20' },
  { name: 'Sad', char: '😢', bg: 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 border-blue-500/20' },
  { name: 'Angry', char: '😠', bg: 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/20' },
  { name: 'Fear', char: '😨', bg: 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 border-purple-500/20' },
  { name: 'Neutral', char: '😐', bg: 'bg-slate-500/10 hover:bg-slate-500/20 text-slate-500 border-slate-500/20' },
]

const EMPTY = { Happy: 0, Sad: 0, Angry: 0, Fear: 0, Neutral: 0 }

export default function EmotionPanel({ onEmotions, autoStart = false, onError } = {}) {
  const videoRef = useRef(null)
  const { status, error, errorType, emotions, fps, faceVisible, calibrating, start, stop } =
    useEmotionTracker(videoRef)

  const [manualEmotion, setManualEmotion] = useState(null)

  const running = status === 'running'
  
  // Choose which emotions object to render: either live face data or manual emoji choice
  const activeEmotions = (running && faceVisible) 
    ? emotions 
    : manualEmotion 
      ? {
          Happy: manualEmotion === 'Happy' ? 1.0 : 0.0,
          Sad: manualEmotion === 'Sad' ? 1.0 : 0.0,
          Angry: manualEmotion === 'Angry' ? 1.0 : 0.0,
          Fear: manualEmotion === 'Fear' ? 1.0 : 0.0,
          Neutral: manualEmotion === 'Neutral' ? 1.0 : 0.0,
        }
      : EMPTY

  const dominant = ORDER.reduce((a, b) => (activeEmotions[b] > activeEmotions[a] ? b : a), 'Neutral')
  const hasEmotions = (running && faceVisible) || manualEmotion

  const autoStarted = useRef(false)

  useEffect(() => {
    if (autoStart && status === 'idle' && !autoStarted.current) {
      autoStarted.current = true
      start()
    }
  }, [autoStart, status, start])

  // Propagate error up if onError is provided
  useEffect(() => {
    if (error && onError) {
      onError({ message: error, type: errorType })
    }
  }, [error, errorType, onError])

  // Report the live facial-emotion vector upward.
  useEffect(() => {
    if (!onEmotions) return
    if (running && faceVisible) {
      onEmotions(emotions)
    } else if (manualEmotion) {
      const vector = {
        Happy: manualEmotion === 'Happy' ? 1.0 : 0.0,
        Sad: manualEmotion === 'Sad' ? 1.0 : 0.0,
        Angry: manualEmotion === 'Angry' ? 1.0 : 0.0,
        Fear: manualEmotion === 'Fear' ? 1.0 : 0.0,
        Neutral: manualEmotion === 'Neutral' ? 1.0 : 0.0,
      }
      onEmotions(vector)
    } else {
      onEmotions(null)
    }
  }, [onEmotions, running, faceVisible, emotions, manualEmotion])

  const handleManualSelect = (name) => {
    setManualEmotion(prev => prev === name ? null : name)
  }

  const handleStartCamera = () => {
    setManualEmotion(null) // clear manual override when starting camera
    start()
  }

  return (
    <div className="card p-6 flex flex-col gap-5">
      <div className="flex items-center justify-between border-b border-border/40 pb-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-fg">
          <ScanFace className="h-5 w-5 text-primary" /> Emotion Analysis
        </h3>
        {running && (
          <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted font-medium border border-border/30">
            <Activity className="h-3.5 w-3.5 text-primary animate-pulse" />
            {fps} FPS
          </span>
        )}
      </div>

      <p className="text-xs text-muted -mt-2">
        On-device camera analysis is fully private. Your video frames are processed locally and never uploaded to any server.
      </p>

      {/* Video / Camera Panel */}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-stretch">
        <div className={`relative overflow-hidden rounded-xl border border-border bg-surface-2/30 aspect-video w-full sm:w-[200px] shrink-0 flex items-center justify-center`}>
          <video
            ref={videoRef}
            width={320}
            height={240}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-cover ${running ? 'block' : 'hidden'}`}
          />
          {!running && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center text-faint">
              <CameraOff className="h-8 w-8 mb-1.5 opacity-60" />
              <span className="text-[11px] font-medium">Camera is Off</span>
            </div>
          )}
          {running && calibrating && (
            <div className="absolute bottom-0 inset-x-0 bg-surface-2/95 border-t border-border/40 flex items-center justify-center gap-1.5 py-1.5 px-2 text-center">
              <RefreshCw className="h-3.5 w-3.5 text-primary animate-spin" />
              <span className="text-[9px] font-semibold text-fg">Calibrating baseline…</span>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col justify-center gap-3 w-full">
          <div>
            {!running ? (
              <button
                onClick={handleStartCamera}
                disabled={status === 'loading'}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-60"
              >
                <Camera className="h-4 w-4" />
                {status === 'loading' ? 'Loading model…' : 'Start Camera'}
              </button>
            ) : (
              <button
                onClick={stop}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-primary px-4 py-2.5 text-xs font-semibold text-primary transition hover:bg-primary/10"
              >
                <CameraOff className="h-4 w-4" /> Stop Camera
              </button>
            )}
          </div>

          {/* Feedback states when running */}
          {running && (
            <div className="text-xs leading-relaxed">
              {calibrating ? (
                <span className="text-primary font-medium flex items-center gap-1.5">
                  <ScanFace className="h-3.5 w-3.5 animate-pulse" /> Hold still to calibrate neutral expression...
                </span>
              ) : faceVisible ? (
                <span className="text-muted">
                  Detected:{' '}
                  <span className="font-semibold px-2 py-0.5 rounded-full text-xs" style={{ color: COLORS[dominant], backgroundColor: `${COLORS[dominant]}15` }}>
                    {dominant}
                  </span>
                </span>
              ) : (
                <span className="text-warning font-medium flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" /> No face in frame — calibration paused
                </span>
              )}
            </div>
          )}

          {/* Specific error troubleshooting */}
          {status === 'error' && (
            <div className="rounded-lg bg-danger-soft p-3 border border-danger/10 text-xs">
              <div className="flex gap-1.5 text-danger font-semibold mb-1">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorType === 'NotAllowedError' ? 'Permission Blocked' : 'Camera Error'}</span>
              </div>
              <p className="text-fg opacity-90">{error}</p>
              {errorType === 'NotAllowedError' && (
                <button
                  onClick={handleStartCamera}
                  className="mt-2 text-[10px] font-bold text-danger underline hover:text-danger/80 block"
                >
                  Click to try again after permitting access
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Manual Emoji Fallback Panel */}
      {!running && (
        <div className="border-t border-border/40 pt-4 flex flex-col gap-3">
          <span className="text-xs font-semibold text-fg flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Manually Select Your Mood
          </span>
          <p className="text-[11px] text-muted">
            Camera unavailable or disabled? Choose an emoji below to share your emotional baseline with Rahat:
          </p>

          <div className="flex justify-between gap-1.5 py-1">
            {EMOJIS.map((emoji) => {
              const isSelected = manualEmotion === emoji.name
              return (
                <motion.button
                  key={emoji.name}
                  type="button"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleManualSelect(emoji.name)}
                  className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all flex-1 ${
                    isSelected
                      ? 'border-primary bg-primary-soft text-primary shadow-sm font-semibold'
                      : `border-transparent ${emoji.bg}`
                  }`}
                >
                  <span className="text-xl mb-0.5">{emoji.char}</span>
                  <span className="text-[10px]">{emoji.name}</span>
                </motion.button>
              )
            })}
          </div>
          {manualEmotion && (
            <div className="flex items-center justify-between text-[10px] bg-surface-2/50 rounded-lg px-2.5 py-1.5 border border-border/20">
              <span className="text-muted font-medium">
                Sharing manual mood: <span className="text-fg font-semibold">{manualEmotion}</span>
              </span>
              <button
                type="button"
                onClick={() => setManualEmotion(null)}
                className="text-danger font-semibold hover:underline"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* Live probability bars */}
      <div className="space-y-2.5 border-t border-border/40 pt-4">
        <span className="text-xs font-semibold text-fg flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Mood Distribution
        </span>
        <div className="space-y-2">
          {ORDER.map((label) => {
            const pct = Math.round((activeEmotions[label] || 0) * 100)
            return (
              <div key={label} className="text-xs">
                <div className="mb-0.5 flex justify-between">
                  <span className="text-fg font-medium">{label}</span>
                  <span className="tabular-nums text-muted">{pct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2/60 border border-border/20">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: COLORS[label] }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

