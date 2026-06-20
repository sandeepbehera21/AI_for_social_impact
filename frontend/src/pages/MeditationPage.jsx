import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play,
  Pause,
  RotateCcw,
  Waves,
  CloudRain,
  Bird,
  Volume2,
  Sparkles,
  X,
  Compass,
  Heart,
  Sliders,
  Info,
  AlertTriangle,
} from 'lucide-react'
import { Navigate } from 'react-router-dom'
import PageTransition from '../components/PageTransition.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const PRESETS = [
  { label: '1 Min', value: 60 },
  { label: '3 Min', value: 180 },
  { label: '5 Min', value: 300 },
  { label: '10 Min', value: 600 },
]

const SOUND_INFO = {
  ocean: { label: 'Ocean Waves', icon: Waves, desc: 'Rhythmic tides for slow breathing' },
  rain: { label: 'Forest Rain', icon: CloudRain, desc: 'Gentle rain on soft forest leaves' },
  birds: { label: 'Morning Birds', icon: Bird, desc: 'Peaceful bird chirps for sunrise calm' },
}

const AMBIENCE_PRESETS = [
  { id: 'deep_sea', label: 'Deep Sea Sanctuary', volumes: { ocean: 0.8, rain: 0, birds: 0 } },
  { id: 'rainy_dawn', label: 'Rainy Morning Woods', volumes: { ocean: 0, rain: 0.75, birds: 0.45 } },
  { id: 'calm_breeze', label: 'Coastal Morning', volumes: { ocean: 0.4, rain: 0, birds: 0.7 } },
]

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function MeditationPage() {
  const { user, role } = useAuth()

  // Redirect doctor role away
  if (user && role === 'doctor') {
    return <Navigate to="/dashboard/doctor" replace />
  }

  // Views: 'dashboard' (bento grid) or 'meditating' (immersive fullscreen breathing)
  const [view, setView] = useState('dashboard')

  // Timer states
  const [sessionDuration, setSessionDuration] = useState(300)
  const [timeLeft, setTimeLeft] = useState(300)
  const [timerRunning, setTimerRunning] = useState(false)
  const timerIntervalRef = useRef(null)

  // Box Breathing states
  const [breathCount, setBreathCount] = useState(0)
  const breathingIntervalRef = useRef(null)

  // Audio elements ref
  const audioRefs = useRef({
    ocean: new Audio('/sounds/ocean.mp3'),
    rain: new Audio('/sounds/rain.mp3'),
    birds: new Audio('/sounds/birds.mp3'),
  })

  // Audio playing & volume states
  const [activeSounds, setActiveSounds] = useState({ ocean: false, rain: false, birds: false })
  const [volumes, setVolumes] = useState({ ocean: 0.5, rain: 0.5, birds: 0.5 })
  const [audioError, setAudioError] = useState('')

  // Loop & unmount audio teardown
  useEffect(() => {
    Object.keys(audioRefs.current).forEach((key) => {
      const audio = audioRefs.current[key]
      audio.loop = true
      audio.addEventListener('error', () => {
        setAudioError('Some sound files were not found. Place .mp3 files in /public/sounds/ to play.')
      })
    })

    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      Object.values(audioRefs.current).forEach((audio) => {
        audio.pause()
      })
    }
  }, [])

  // Timer Ticking effect
  useEffect(() => {
    if (timerRunning) {
      timerIntervalRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            setTimerRunning(false)
            return 0
          }
          return t - 1
        })
      }, 1000)
    } else {
      clearInterval(timerIntervalRef.current)
    }
    return () => clearInterval(timerIntervalRef.current)
  }, [timerRunning])

  // Breathing Ticking effect
  useEffect(() => {
    if (timerRunning && view === 'meditating') {
      breathingIntervalRef.current = setInterval(() => {
        setBreathCount((c) => (c + 1) % 16)
      }, 1000)
    } else {
      clearInterval(breathingIntervalRef.current)
      setBreathCount(0)
    }
    return () => clearInterval(breathingIntervalRef.current)
  }, [timerRunning, view])

  // Sound mixer trigger
  const toggleSound = (id) => {
    const audio = audioRefs.current[id]
    const nextState = !activeSounds[id]
    setActiveSounds((prev) => ({ ...prev, [id]: nextState }))

    if (nextState) {
      audio.volume = volumes[id]
      audio.play().catch(() => {
        setAudioError('Audio file unavailable. Add your custom mp3 sounds to /public/sounds/')
      })
    } else {
      audio.pause()
    }
  }

  // Volume slider callback
  const handleVolumeChange = (id, vol) => {
    setVolumes((prev) => ({ ...prev, [id]: vol }))
    const audio = audioRefs.current[id]
    audio.volume = vol
    if (vol > 0 && !activeSounds[id]) {
      setActiveSounds((prev) => ({ ...prev, [id]: true }))
      audio.play().catch(() => {})
    } else if (vol === 0 && activeSounds[id]) {
      setActiveSounds((prev) => ({ ...prev, [id]: false }))
      audio.pause()
    }
  }

  // Load environment sound presets
  const applyPreset = (preset) => {
    setAudioError('')
    Object.keys(preset.volumes).forEach((id) => {
      const vol = preset.volumes[id]
      const audio = audioRefs.current[id]
      setVolumes((prev) => ({ ...prev, [id]: vol }))

      if (vol > 0) {
        audio.volume = vol
        setActiveSounds((prev) => ({ ...prev, [id]: true }))
        audio.play().catch(() => {})
      } else {
        audio.pause()
        setActiveSounds((prev) => ({ ...prev, [id]: false }))
      }
    })
  }

  // Stop all sounds
  const stopAllAudio = () => {
    Object.keys(audioRefs.current).forEach((key) => {
      audioRefs.current[key].pause()
    })
    setActiveSounds({ ocean: false, rain: false, birds: false })
  }

  // Session controls
  const enterMeditation = () => {
    setView('meditating')
    setTimerRunning(true)
  }

  const exitMeditation = () => {
    setView('dashboard')
    setTimerRunning(false)
    setBreathCount(0)
  }

  const resetSession = () => {
    setTimerRunning(false)
    setTimeLeft(sessionDuration)
    setBreathCount(0)
  }

  const start = () => timeLeft > 0 && setTimerRunning(true)
  const pause = () => setTimerRunning(false)

  // Derive breathing text instructions
  const breathingPhase = useMemo(() => {
    if (!timerRunning) return { text: 'Prepare to Breathe', state: 'idle', color: 'text-muted' }
    if (breathCount < 4) {
      return { text: 'Inhale Slowly', state: 'inhale', color: 'text-primary' }
    } else if (breathCount < 8) {
      return { text: 'Hold Your Breath', state: 'hold1', color: 'text-accent' }
    } else if (breathCount < 12) {
      return { text: 'Exhale Gently', state: 'exhale', color: 'text-primary' }
    } else {
      return { text: 'Hold Your Breath', state: 'hold2', color: 'text-accent' }
    }
  }, [breathCount, timerRunning])

  const progress = 1 - timeLeft / sessionDuration

  // Generate slow background floating particles
  const particles = useMemo(() => {
    return Array.from({ length: 12 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 2,
      duration: Math.random() * 25 + 20,
      delay: Math.random() * -20,
    }))
  }, [])

  return (
    <PageTransition className="relative min-h-[90vh] overflow-hidden flex flex-col justify-center items-center text-fg px-5 sm:px-10">
      {/* Immersive Calm Background Styles */}
      <div className="absolute inset-0 -z-20 bg-bg" />

      {/* Ambient Pulsing Orbs */}
      <div className="absolute top-[-20%] left-[-10%] h-[500px] w-[500px] rounded-full bg-primary/5 blur-[150px] -z-10 animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full bg-accent/5 blur-[160px] -z-10 animate-pulse" />

      {/* Slow Floating Particle Field */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        {particles.map((p) => (
          <motion.div
            key={p.id}
            className="absolute rounded-full bg-primary/10"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
            }}
            animate={{
              y: ['0vh', '-100vh'],
              opacity: [0.1, 0.6, 0.1],
            }}
            transition={{
              duration: p.duration,
              repeat: Infinity,
              ease: 'linear',
              delay: p.delay,
            }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {view === 'dashboard' ? (
          // ── VIEW 1: MODERN BENTO MEDITATION DASHBOARD ──
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-5xl space-y-8 py-10"
          >
            {/* Immersive Greeting Card */}
            <header className="card p-8 relative overflow-hidden flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="text-center md:text-left space-y-2.5">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-soft border border-primary/20 text-xs font-semibold text-primary tracking-wider uppercase">
                  <Sparkles className="h-3 w-3" /> Space of Calm
                </div>
                <h1 className="text-3xl font-extrabold sm:text-4xl tracking-tight">
                  Welcome to Stillness.
                </h1>
                <p className="text-muted max-w-lg text-sm sm:text-base leading-relaxed">
                  Mindfulness isn’t about clearing your thoughts—it is about finding the anchor. Connect your earphones, adjust the ambiance, and select an exercise below.
                </p>
              </div>

              {/* Zero-friction quick start button */}
              <button
                onClick={enterMeditation}
                className="relative group overflow-hidden px-8 py-4 rounded-2xl bg-primary text-primary-fg font-bold tracking-wide transition shadow-sm hover:bg-primary-hover hover:scale-[1.02] cursor-pointer"
              >
                <span className="absolute inset-0 bg-primary-fg/10 group-hover:scale-x-100 transform origin-left transition duration-350" />
                <span className="relative z-10 flex items-center gap-2">
                  <Play className="h-4 w-4 fill-current" /> Quick Start (5m)
                </span>
              </button>
            </header>

            {/* Bento Grid */}
            <div className="grid gap-6 md:grid-cols-3">
              
              {/* BENTO CARD 1: Box Breathing Launcher */}
              <div className="card p-6 flex flex-col justify-between hover:border-primary/40 transition-all duration-300 md:col-span-1 min-h-[260px]">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-2xl bg-primary-soft border border-primary/20 text-primary">
                      <Compass className="h-5 w-5" />
                    </div>
                    <div className="flex gap-1">
                      {PRESETS.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => {
                            setSessionDuration(p.value)
                            setTimeLeft(p.value)
                          }}
                          className={`px-2 py-1 text-[10px] font-bold rounded-lg border transition ${
                            sessionDuration === p.value
                              ? 'bg-primary-soft border-primary/40 text-primary'
                              : 'border-transparent text-muted hover:text-fg'
                          }`}
                        >
                          {p.label.split(' ')[0]}m
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-fg mb-1.5">Box Breathing Guide</h3>
                    <p className="text-xs text-muted leading-relaxed">
                      Restore neurological balance and ease anxiety using the square breathing technique. Set your duration and begin.
                    </p>
                  </div>
                </div>

                <button
                  onClick={enterMeditation}
                  className="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl border border-primary/20 bg-primary-soft text-xs font-bold text-primary hover:bg-primary-soft hover:border-primary/40 transition cursor-pointer"
                >
                  Start Breathing Guide
                </button>
              </div>

              {/* BENTO CARD 2: Ambient Soundscape Mixer */}
              <div className="card p-6 md:col-span-2 flex flex-col justify-between hover:border-accent/40 transition-all duration-300 min-h-[260px]">
                <div className="space-y-4 w-full">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-3 rounded-2xl bg-accent-soft border border-accent/20 text-accent">
                        <Sliders className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-fg">Ambient Sound Mixer</h3>
                        <p className="text-[11px] text-muted">Mix, blend, and create your personalized relaxation environment.</p>
                      </div>
                    </div>

                    {Object.values(activeSounds).some(Boolean) && (
                      <button
                        onClick={stopAllAudio}
                        className="text-[10px] font-bold text-danger hover:text-danger transition uppercase tracking-wider px-2.5 py-1 rounded-lg bg-danger-soft border border-danger/20"
                      >
                        Mute All
                      </button>
                    )}
                  </div>

                  {/* Sound controls slider listing */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    {Object.keys(SOUND_INFO).map((key) => {
                      const sound = SOUND_INFO[key]
                      const active = activeSounds[key]
                      const vol = volumes[key]

                      return (
                        <div
                          key={key}
                          className={`p-4 rounded-2xl border transition-all ${
                            active
                              ? 'border-accent/40 bg-accent-soft'
                              : 'border-border bg-surface-2'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-fg">{sound.label}</span>
                            <button
                              onClick={() => toggleSound(key)}
                              className={`p-1.5 rounded-lg border transition ${
                                active
                                  ? 'bg-accent-soft border-accent/40 text-accent'
                                  : 'border-border text-muted hover:text-fg'
                              }`}
                            >
                              <sound.icon className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {/* Slider input */}
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-faint">0</span>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={vol}
                              onChange={(e) => handleVolumeChange(key, parseFloat(e.target.value))}
                              className="w-full accent-[var(--accent)] h-1 bg-surface-2 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-[10px] text-faint">{Math.round(vol * 100)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Ambience presets */}
                <div className="flex flex-wrap gap-2 items-center mt-4 pt-4 border-t border-border">
                  <span className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                    <Info className="h-3 w-3" /> Quick Presets:
                  </span>
                  {AMBIENCE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-surface-2 border border-border hover:border-border-strong transition cursor-pointer text-muted hover:text-fg"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* BENTO CARD 3: Mindfulness Reflection */}
              <div className="card p-6 md:col-span-2 flex flex-col justify-between min-h-[200px] hover:border-accent/40 transition-all duration-300">
                <div className="space-y-3">
                  <div className="p-3 rounded-2xl bg-accent-soft border border-accent/20 text-accent w-fit">
                    <Heart className="h-5 w-5" />
                  </div>
                  <h4 className="text-base font-bold text-fg">Mindfulness Quote of the Day</h4>
                  <p className="text-xs italic text-muted font-serif leading-relaxed">
                    &ldquo;Within you, there is a stillness and a sanctuary to which you can retreat at any time and be yourself.&rdquo;
                  </p>
                </div>
                <div className="text-[10px] text-faint font-semibold uppercase tracking-wider mt-4">
                  &mdash; Hermann Hesse
                </div>
              </div>

              {/* BENTO CARD 4: Audio Files Alert indicator */}
              <div className="card p-6 flex flex-col justify-between min-h-[200px] hover:border-warning/40 transition-all duration-300">
                <div className="space-y-3">
                  <div className="p-3 rounded-2xl bg-warning-soft border border-warning/20 text-warning w-fit animate-pulse">
                    <Volume2 className="h-5 w-5" />
                  </div>
                  <h4 className="text-base font-bold text-fg">Audio Environment Status</h4>
                  <p className="text-xs text-muted leading-relaxed">
                    Check if custom ambient sounds are active. Toggle the card buttons in the mixer to play background noises.
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-border">
                  {audioError ? (
                    <div className="flex items-start gap-2 rounded-xl border border-warning/20 bg-warning-soft p-3">
                      <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                      <div className="text-[11px] font-medium text-warning leading-normal">
                        {audioError}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] font-semibold text-success flex items-center gap-1">
                      <div className="h-1.5 w-1.5 rounded-full bg-success animate-ping" /> Sounds hydrated
                    </div>
                  )}
                </div>
              </div>

            </div>
          </motion.div>
        ) : (
          // ── VIEW 2: FULL-SCREEN CALM BREATHING INTERFACE ──
          <motion.div
            key="meditating"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="w-full max-w-xl flex flex-col items-center justify-between min-h-[75vh] py-10 text-center relative"
          >
            {/* Header exit session */}
            <div className="w-full flex justify-between items-center mb-6">
              <span className="text-[10px] tracking-widest uppercase font-semibold text-faint flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Session in progress
              </span>
              <button
                onClick={exitMeditation}
                className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-border bg-surface-2 text-xs text-muted hover:text-fg hover:bg-elevated transition cursor-pointer"
              >
                <X className="h-3.5 w-3.5" /> End Ambiance
              </button>
            </div>

            {/* Immersive Breathing Anchor */}
            <div className="my-auto space-y-12 w-full flex flex-col items-center">
              
              {/* Glowing breathing rings */}
              <div className="relative flex h-64 w-64 items-center justify-center">
                {/* outer pinging rings */}
                <div className="absolute inset-0 rounded-full border border-primary/10 animate-ping" style={{ animationDuration: '6s' }} />
                <div className="absolute inset-4 rounded-full border border-accent/10 animate-ping" style={{ animationDuration: '4s', animationDelay: '2s' }} />

                {/* Animated breathing circle */}
                <motion.div
                  animate={{
                    scale:
                      breathingPhase.state === 'inhale'
                        ? 1.4
                        : breathingPhase.state === 'hold1'
                        ? 1.4
                        : 1.0,
                  }}
                  transition={{
                    duration: 4,
                    ease: 'easeInOut',
                  }}
                  className="absolute h-48 w-48 rounded-full flex items-center justify-center"
                  style={{
                    background: `radial-gradient(circle, color-mix(in srgb, var(--primary) 14%, transparent) 0%, color-mix(in srgb, var(--accent) 12%, transparent) 100%)`,
                    boxShadow:
                      breathingPhase.state === 'inhale' || breathingPhase.state === 'hold1'
                        ? '0 0 50px color-mix(in srgb, var(--primary) 30%, transparent), inset 0 0 25px color-mix(in srgb, var(--accent) 20%, transparent)'
                        : '0 0 25px color-mix(in srgb, var(--fg) 8%, transparent)',
                    border: '1.5px solid color-mix(in srgb, var(--primary) 35%, transparent)',
                  }}
                />

                {/* Text prompts inside bubble */}
                <div className="relative z-10 flex flex-col items-center justify-center">
                  <span className={`text-sm font-bold tracking-wider uppercase mb-1.5 transition-colors duration-500 ${breathingPhase.color}`}>
                    {breathingPhase.text}
                  </span>
                  <span className="text-4xl font-extrabold tabular-nums tracking-tighter text-fg">
                    {formatTime(timeLeft)}
                  </span>
                </div>

                {/* SVG circular progress loader */}
                <svg className="absolute inset-0 w-full h-full transform -rotate-90 pointer-events-none">
                  <circle
                    cx="128"
                    cy="128"
                    r="110"
                    className="stroke-border fill-transparent"
                    strokeWidth="1.5"
                  />
                  <motion.circle
                    cx="128"
                    cy="128"
                    r="110"
                    className="stroke-primary fill-transparent"
                    strokeWidth="2.5"
                    strokeDasharray={2 * Math.PI * 110}
                    animate={{ strokeDashoffset: 2 * Math.PI * 110 * (1 - progress) }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              {/* Session controls */}
              <div className="flex justify-center gap-3">
                {timerRunning ? (
                  <button onClick={pause} className="med-btn">
                    <Pause className="h-4 w-4 fill-current" /> Pause Session
                  </button>
                ) : (
                  <button onClick={start} className="med-btn med-btn-primary">
                    <Play className="h-4 w-4 fill-current" /> Resume Session
                  </button>
                )}
                <button onClick={resetSession} className="med-btn">
                  <RotateCcw className="h-4 w-4" /> Restart
                </button>
              </div>

            </div>

            {/* Quick sound adjustments in meditation mode */}
            <div className="w-full card px-6 py-4 flex flex-col sm:flex-row items-center sm:justify-between gap-3 mt-6 text-center sm:text-left">
              <span className="text-xs text-muted flex items-center gap-1.5">
                <Volume2 className="h-4 w-4 text-primary" /> Sound Ambiance:
              </span>
              <div className="flex flex-wrap justify-center gap-2">
                {Object.keys(SOUND_INFO).map((key) => {
                  const s = SOUND_INFO[key]
                  const active = activeSounds[key]
                  return (
                    <button
                      key={key}
                      onClick={() => toggleSound(key)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                        active
                          ? 'border-primary/40 bg-primary-soft text-primary'
                          : 'border-border bg-surface-2 text-muted hover:text-fg'
                      }`}
                    >
                      <s.icon className="h-3.5 w-3.5" /> {s.label.split(' ')[0]}
                    </button>
                  )
                })}
              </div>
            </div>

            {audioError && (
              <div className="w-full mt-4 flex items-start gap-2 rounded-xl border border-warning/20 bg-warning-soft p-3.5 text-left animate-fade-in">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div className="text-xs font-medium text-warning leading-normal flex-1">
                  {audioError}
                </div>
                <button
                  onClick={() => setAudioError('')}
                  className="p-0.5 rounded hover:bg-surface-2 text-muted hover:text-fg transition cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* Aesthetic calming style sheets */}
      <style>{`
        .med-btn {
          display: inline-flex; align-items: center; gap: 0.5rem;
          padding: 0.7rem 1.4rem; border-radius: 0.85rem;
          background: var(--surface-2); color: var(--muted);
          border: 1px solid var(--border); font-weight: 600; font-size: 0.85rem;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }
        .med-btn:hover {
          background: var(--elevated);
          border-color: var(--primary);
          color: var(--fg);
          transform: translateY(-2px);
          box-shadow: 0 4px 25px color-mix(in srgb, var(--primary) 15%, transparent);
        }
        .med-btn-primary {
          background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 15%, transparent) 0%, color-mix(in srgb, var(--accent) 15%, transparent) 100%);
          border-color: color-mix(in srgb, var(--primary) 35%, transparent);
          color: var(--primary);
        }
        .med-btn-primary:hover {
          background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 25%, transparent) 0%, color-mix(in srgb, var(--accent) 25%, transparent) 100%);
          border-color: var(--primary);
          box-shadow: 0 0 25px color-mix(in srgb, var(--primary) 30%, transparent);
        }
      `}</style>
    </PageTransition>
  )
}
