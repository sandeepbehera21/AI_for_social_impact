import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Send,
  Loader2,
  ShieldAlert,
  Phone,
  CalendarHeart,
  Brain,
  Waves,
  Stethoscope,
  ShieldCheck,
  Sparkles,
  BookOpen,
  Activity,
  LifeBuoy,
  Lightbulb,
  Download,
  RefreshCw,
} from 'lucide-react'
import { collection, getDocs, query, where, addDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import PageTransition from '../components/PageTransition.jsx'
import EmotionPanel from '../components/EmotionPanel.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import { createChatSocket, sendChatMessage } from '../lib/api.js'
import { deriveActions } from '../lib/chatActions.js'
import { useAuth } from '../context/AuthContext.jsx'
import { ROLES } from '../lib/roles.js'
import { recordMood, dominantOf } from '../lib/moodHistory.js'

const GREETING = {
  role: 'bot',
  text: "Hi, I'm Rahat 🌱 — your MindEase companion. How are you feeling today?",
  actions: [],
}

// Map an action key to its icon
const ACTION_ICONS = {
  meditation: Waves,
  doctor: Stethoscope,
  privacy: ShieldCheck,
  journal: BookOpen,
  cbt: Brain,
  habits: Activity,
  sos: LifeBuoy,
}

// Gentle conversation starters shown before the first user message.
const STATIC_SUGGESTIONS = [
  "I've been feeling anxious lately",
  'I had a hard day',
  'I want to talk about my mood',
  'Help me relax',
]

const CONNECTION_LABEL = {
  connecting: { dot: 'bg-warning', text: 'Connecting…' },
  open: { dot: 'bg-success', text: 'Live' },
  reconnecting: { dot: 'bg-warning animate-pulse', text: 'Reconnecting…' },
  closed: { dot: 'bg-faint', text: 'Offline — using fallback' },
}

const STATE_NAMES = {
  stress_discussion: 'Stress & Relief',
  anxiety_discussion: 'Anxiety Coping',
  daily_checkin: 'Daily Check-in',
  meditation_guidance: 'Mindfulness & Meditation',
  doctor_booking: 'Professional Support',
  crisis_intervention: 'Safety Care',
  greeting: 'Greeting',
}

export default function ChatPage() {
  const { user, role } = useAuth()

  // NOTE: early-return CANNOT go here — it would violate Rules of Hooks.
  // Doctor redirect is handled at JSX level below (after all hooks).

  const [messages, setMessages] = useState([GREETING])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [connection, setConnection] = useState('connecting')
  const [crisis, setCrisis] = useState(null)
  const [showResources, setShowResources] = useState(false)
  
  // Dynamic conversation starters
  const [suggestions, setSuggestions] = useState(STATIC_SUGGESTIONS)
  const [personalSuggestions, setPersonalSuggestions] = useState(STATIC_SUGGESTIONS)

  const chatBoxRef = useRef(null)
  const socketRef = useRef(null)
  const textareaRef = useRef(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Session id stored in localStorage for cross-tab continuity
  const sessionIdRef = useRef(
    (() => {
      const stored = localStorage.getItem('mindease_session_id')
      if (stored) return stored
      const fresh = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      localStorage.setItem('mindease_session_id', fresh)
      return fresh
    })()
  )

  // Latest on-device facial-emotion snapshot
  const facialRef = useRef(null)
  const handleEmotions = useCallback((emotions) => {
    facialRef.current = emotions
  }, [])

  // Load chat history from localStorage keyed by user UID
  useEffect(() => {
    setHistoryLoaded(false)
    const chatKey = `mindease_chat_${user?.uid || 'anon'}`
    const stored = localStorage.getItem(chatKey)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed)
          
          // Populate feedback state from loaded history
          const ratings = {}
          parsed.forEach((m, idx) => {
            if (m.rating) {
              ratings[idx] = m.rating
            }
          })
          setRatedMessages(ratings)
          setHistoryLoaded(true)
          return
        }
      } catch (e) {
        console.warn('Failed to parse stored chat history', e)
      }
    }
    
    // Initialize default greeting with timestamp
    setMessages([{ ...GREETING, timestamp: Date.now() }])
    setHistoryLoaded(true)
  }, [user?.uid])

  // Save chat history to localStorage keyed by user UID
  useEffect(() => {
    if (!historyLoaded) return
    const chatKey = `mindease_chat_${user?.uid || 'anon'}`
    if (messages && messages.length > 0) {
      const toSave = messages.slice(-50)
      localStorage.setItem(chatKey, JSON.stringify(toSave))
    }
  }, [messages, user?.uid, historyLoaded])

  // Auto-grow message input textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(160, Math.max(48, el.scrollHeight))}px`
  }, [input])

  // Mood history logging every 30s
  useEffect(() => {
    if (!user?.uid || role !== ROLES.PATIENT) return
    const SAMPLE_MS = 30_000
    const id = setInterval(() => {
      const top = dominantOf(facialRef.current)
      if (!top || top.confidence < 0.34) return
      recordMood(user.uid, {
        dominant: top.dominant,
        confidence: top.confidence,
        scores: facialRef.current,
      }).catch((err) => console.error('[mood] record failed', err))
    }, SAMPLE_MS)
    return () => clearInterval(id)
  }, [user?.uid, role])

  // Personalise conversation starters from user's most recent journal entry
  useEffect(() => {
    if (!user?.uid) return
    ;(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'journals'), where('patientId', '==', user.uid)),
        )
        if (snap.empty) return
        const all = snap.docs.map((d) => d.data())
        all.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        const latest = all[0]
        const topic = latest?.topic || 'general'
        const emotion = latest?.emotion
        const generated = []
        if (topic && topic !== 'general') {
          generated.push(`I want to talk about my ${topic} situation`)
          generated.push(`How can I cope better with ${topic} stress?`)
        }
        if (emotion && emotion !== 'neutral') {
          generated.push(`I've been feeling ${emotion.toLowerCase()} lately`)
        } else {
          generated.push("I've been feeling anxious lately")
        }
        generated.push('Help me with a breathing exercise')
        const finalSugg = generated.slice(0, 4)
        setPersonalSuggestions(finalSugg)
        
        // Only override suggestions on mount if there is only the greeting
        setSuggestions((current) => (current.length === STATIC_SUGGESTIONS.length ? finalSugg : current))
      } catch {
        // Network/permission error — keep static defaults
      }
    })()
  }, [user?.uid])

  // Open realtime chat socket
  useEffect(() => {
    const socket = createChatSocket({
      onMessage: (payload) => {
        handlePayload(payload)
        setSending(false)
      },
      onStatus: (state) => setConnection(state),
      onError: () => {
        /* fallback handles sends */
      },
    })
    socketRef.current = socket
    return () => socket.close()
  }, [user])

  // Auto scroll-to-bottom
  useEffect(() => {
    const box = chatBoxRef.current
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
  }, [messages, sending, crisis, showResources])

  const handlePayload = (payload) => {
    if (payload?.type === 'error') {
      setMessages((m) => [
        ...m,
        {
          role: 'bot',
          text: '⚠️ Sorry, something went wrong. Please try again.',
          actions: [],
          timestamp: Date.now(),
        },
      ])
      return
    }
    
    // Add bot response with timestamp and backend insights analysis
    setMessages((m) => [
      ...m,
      {
        role: 'bot',
        text: payload.response,
        actions: deriveActions(payload),
        timestamp: Date.now(),
        analysis: payload.analysis,
      },
    ])

    // Update suggestions (fall back to personal suggestions so they never disappear)
    if (payload?.suggestions && payload.suggestions.length > 0) {
      setSuggestions(payload.suggestions)
    } else {
      setSuggestions(personalSuggestions)
    }

    if (payload?.type === 'safety_trigger') {
      setCrisis({
        hotlines: payload.hotlines || [],
        route: payload.book_consultation_route || '/consult-doc',
      })
      setShowResources(false)
    }
  }

  const [ratedMessages, setRatedMessages] = useState({})
  const handleFeedback = async (msgIdx, rating) => {
    if (!user) return
    const msg = messages[msgIdx]
    if (!msg) return

    setMessages((prev) => {
      const copy = [...prev]
      if (copy[msgIdx]) {
        copy[msgIdx] = { ...copy[msgIdx], rating }
      }
      return copy
    })
    setRatedMessages((prev) => ({ ...prev, [msgIdx]: rating }))

    try {
      await addDoc(collection(db, 'chatbot_feedback'), {
        patientId: user.uid,
        sessionId: sessionIdRef.current,
        messageText: msg.text,
        rating: rating,
        timestamp: Date.now(),
      })
    } catch (err) {
      console.error('[ChatPage] Error saving chatbot feedback:', err)
    }
  }

  const send = async (override) => {
    const text = (typeof override === 'string' ? override : input).trim()
    if (!text || sending || crisis) return
    
    // Add user message with timestamp
    setMessages((m) => [...m, { role: 'user', text, timestamp: Date.now() }])
    setInput('')
    setSending(true)

    const facial = facialRef.current
    const sid = sessionIdRef.current
    const socket = socketRef.current
    if (socket?.ready) {
      socket.send(text, facial, sid, user?.uid)
      return
    }
    try {
      const payload = await sendChatMessage(text, facial, sid, user?.uid)
      handlePayload(payload)
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: 'bot',
          text: `⚠️ ${err.message || 'Connection problem. Please try again.'}`,
          actions: [],
          timestamp: Date.now(),
        },
      ])
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // Export history as a nicely formatted text transcript file
  const exportChat = () => {
    const header = `MindEase Chat Session - ${new Date().toLocaleDateString()}\nSession ID: ${sessionIdRef.current}\n==================================================\n\n`
    const body = messages
      .map((m) => {
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ''
        const sender = m.role === 'user' ? 'Patient' : 'Rahat (AI Companion)'
        return `[${time}] ${sender}:\n${m.text}\n`
      })
      .join('\n')
    const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mindease_chat_${Date.now()}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Clear chat history, regenerate session token and restart conversation
  const resetChat = () => {
    const fresh = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem('mindease_session_id', fresh)
    sessionIdRef.current = fresh
    const chatKey = `mindease_chat_${user?.uid || 'anon'}`
    localStorage.removeItem(chatKey)
    setMessages([
      {
        role: 'bot',
        text: "Hi, I'm Rahat 🌱 — your MindEase companion. How are you feeling today?",
        actions: [],
        timestamp: Date.now(),
      },
    ])
    setSuggestions(personalSuggestions)
    setRatedMessages({})
  }

  // Insights computations: scan messages history for named entities and state
  const getInsights = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'bot' && msg.analysis?.named_entities) {
        const ne = msg.analysis.named_entities
        if (ne.conversation_summary || ne.exam_subject || ne.relationship_entity) {
          return ne
        }
      }
    }
    return null
  }
  const insights = getInsights()

  const getLatestState = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'bot' && msg.analysis?.conversation_state) {
        return msg.analysis.conversation_state
      }
    }
    return null
  }
  const latestState = getLatestState()
  const activeTopicName = latestState ? (STATE_NAMES[latestState] || null) : null

  // Helper to render messages dynamically grouping by date and appending HH:MM timestamps
  const renderMessageList = () => {
    const elements = []
    let lastDateStr = ''

    messages.forEach((m, idx) => {
      const timestamp = m.timestamp || Date.now()
      const date = new Date(timestamp)
      const dateStr = date.toDateString()

      if (dateStr !== lastDateStr) {
        lastDateStr = dateStr
        let displayDate = ''
        const today = new Date().toDateString()
        const yesterday = new Date(Date.now() - 86400000).toDateString()

        if (dateStr === today) {
          displayDate = 'Today'
        } else if (dateStr === yesterday) {
          displayDate = 'Yesterday'
        } else {
          displayDate = date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        }

        elements.push(
          <div key={`date-${timestamp}-${idx}`} className="mb-4 flex justify-center">
            <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-faint shadow-sm border border-border/40">
              {displayDate}
            </span>
          </div>
        )
      }

      const timeStr = date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })

      const isUser = m.role === 'user'
      elements.push(
        <div
          key={`msg-${idx}`}
          className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'} animate-slide-in`}
        >
          {isUser ? (
            <div className="flex flex-col items-end max-w-[80%]">
              <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-fg shadow-sm">
                {m.text}
              </div>
              <span className="mt-1 text-[10px] text-faint mr-1">{timeStr}</span>
            </div>
          ) : (
            <div className="flex max-w-[88%] gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Brain className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <div className="rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-fg shadow-sm">
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.actions?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {m.actions.map((a) => {
                        const Icon = ACTION_ICONS[a.key]
                        return (
                          <Link
                            key={a.key}
                            to={a.to}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary hover:text-primary-fg"
                          >
                            {Icon && <Icon className="h-3.5 w-3.5" />}
                            {a.label}
                          </Link>
                        )
                      })}
                    </div>
                  )}

                  {/* Feedback Buttons */}
                  {user && idx > 0 && (
                    <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-border/40 pt-2 text-faint">
                      <button
                        type="button"
                        onClick={() => handleFeedback(idx, 'like')}
                        disabled={ratedMessages[idx]}
                        className={`p-1 transition rounded-md hover:bg-surface-2 ${
                          ratedMessages[idx] === 'like' ? 'text-success font-bold' : 'hover:text-success'
                        }`}
                        title="Helpful"
                      >
                        <svg className="h-4 w-4" fill={ratedMessages[idx] === 'like' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.757c1.27 0 2.222 1.226 1.83 2.45l-2.03 6.32a3 3 0 01-2.85 2.23H8.5a1 1 0 01-1-1V10.5a1 1 0 01.3-.7l4.3-4.3a1.5 1.5 0 012.1 2.1L14 10zM2 10h3v10H2V10z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(idx, 'dislike')}
                        disabled={ratedMessages[idx]}
                        className={`p-1 transition rounded-md hover:bg-surface-2 ${
                          ratedMessages[idx] === 'dislike' ? 'text-danger font-bold' : 'hover:text-danger'
                        }`}
                        title="Not helpful"
                      >
                        <svg className="h-4 w-4" fill={ratedMessages[idx] === 'dislike' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.243c-1.27 0-2.222-1.226-1.83-2.45l2.03-6.32a3 3 0 012.875 2H15.5a1 1 0 011 1v10.5a1 1 0 01-.3.7l-4.3 4.3a1.5 1.5 0 01-2.1-2.1L10 14zM22 14h-3V4h3v10z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                <span className="mt-1 text-[10px] text-faint ml-1">{timeStr}</span>
              </div>
            </div>
          )}
        </div>
      )
    })
    return elements
  }

  const blocked = Boolean(crisis)
  const conn = CONNECTION_LABEL[connection] || CONNECTION_LABEL.connecting
  const showSuggestions = !blocked && !sending && suggestions.length > 0 && messages[messages.length - 1]?.role === 'bot'

  // Doctor redirect — placed here AFTER all hooks to comply with Rules of Hooks
  if (user && role === 'doctor') {
    return <Navigate to="/dashboard/doctor" replace />
  }

  return (
    <PageTransition className="mx-auto max-w-6xl px-4 py-8 sm:px-5 sm:py-12 animate-fade-up">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-fg">Chat with MindEase</h1>
        <p className="mt-2 text-muted">
          A calm, judgement-free space — supported by our AI companion, Rahat.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5 items-start">
        {/* Chat Main container */}
        <div className="card flex flex-col overflow-hidden p-0 lg:col-span-3">
          {/* Header row with status and actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Brain className="h-5 w-5" />
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-fg">Rahat</div>
                <div className="text-xs text-muted">MindEase companion</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportChat}
                disabled={messages.length <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export chat history"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export</span>
              </button>
              <button
                type="button"
                onClick={resetChat}
                className="inline-flex items-center gap-1 rounded-lg border border-danger/40 px-2.5 py-1.5 text-xs font-semibold text-danger hover:bg-danger-soft transition"
                title="Reset chat history"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
              <div className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted border border-border/30">
                <span className={`h-2 w-2 rounded-full ${conn.dot}`} />
                {conn.text}
              </div>
            </div>
          </div>

          <div
            ref={chatBoxRef}
            className="chat-scroll h-[440px] overflow-y-auto bg-surface-2/40 px-4 py-5 sm:px-5"
          >
            {renderMessageList()}

            {sending && (
              <div className="mb-4 flex justify-start">
                <div className="flex gap-2.5">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <Brain className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3.5 shadow-sm">
                    <span className="typing-dot h-2 w-2 rounded-full bg-muted" style={{ animationDelay: '0ms' }} />
                    <span className="typing-dot h-2 w-2 rounded-full bg-muted" style={{ animationDelay: '160ms' }} />
                    <span className="typing-dot h-2 w-2 rounded-full bg-muted" style={{ animationDelay: '320ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Suggested prompts */}
            {showSuggestions && (
              <div className="mt-2 flex flex-col items-start gap-2 pl-11">
                <span className="flex items-center gap-1.5 text-xs font-medium text-faint">
                  <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" /> Try saying
                </span>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-fg transition hover:border-primary hover:text-primary hover:shadow-sm"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Crisis safety panel */}
            {blocked && (
              <div className="mt-2 rounded-2xl border border-danger/40 bg-danger-soft p-4">
                <div className="mb-2 flex items-center gap-2 font-semibold text-danger">
                  <ShieldAlert className="h-5 w-5 animate-bounce" /> You don't have to go through this alone
                </div>
                <p className="mb-3 text-sm text-fg">
                  Please reach out right now. If you're in immediate danger, call your
                  local emergency number.
                </p>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Link
                    to={crisis.route}
                    className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-danger-fg transition hover:brightness-110"
                  >
                    <CalendarHeart className="h-4 w-4" /> Book Doctor Consultation
                  </Link>
                  <button
                    type="button"
                    onClick={() => setShowResources((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-lg border border-danger/50 px-4 py-2.5 text-sm font-semibold text-danger transition hover:bg-danger/10"
                  >
                    <Phone className="h-4 w-4" /> View Emergency Resources
                  </button>
                </div>
                {showResources && (
                  <ul className="space-y-1.5">
                    {crisis.hotlines.map((h, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-fg">
                        <Phone className="h-4 w-4 text-danger" />
                        <span className="font-medium">{h.name}</span>
                        <span className="text-muted">— {h.phone}</span>
                        <span className="text-xs text-faint">({h.region})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Message input panel */}
          <div className="flex flex-col gap-2 border-t border-border bg-surface p-3 sm:p-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative flex flex-col justify-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={blocked}
                  rows={1}
                  placeholder={blocked ? 'Chat paused — please use the resources above' : 'Type your message…'}
                  className="w-full resize-none rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm text-fg outline-none transition placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 thin-scroll"
                  style={{ minHeight: '48px', maxHeight: '160px' }}
                />
                {input.length > 100 && (
                  <span className="absolute bottom-1 right-2.5 text-[9px] font-semibold text-faint bg-surface/80 rounded px-1 shadow-sm">
                    {input.length} / 4000
                  </span>
                )}
              </div>
              <button
                onClick={() => send()}
                disabled={sending || blocked || !input.trim()}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span className="hidden sm:inline">Send</span>
              </button>
            </div>
            <p className="mt-2.5 text-center text-[10px] text-muted/65 leading-relaxed">
              MindEase Rahat is an AI companion designed for educational and self-reflection support. It is not a clinical tool, diagnostic service, or crisis lifeline. If you are in distress, please consult a professional or call emergency services.
            </p>
          </div>
        </div>

        {/* Sidebar Column: Emotion Panel + Pinned Insights */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <ErrorBoundary>
            <EmotionPanel onEmotions={handleEmotions} autoStart={true} />
          </ErrorBoundary>

          {/* Pinned Insights Card */}
          <div className="card p-6 flex flex-col gap-4">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-fg">
              <Lightbulb className="h-5 w-5 text-accent animate-pulse" /> Pinned Insights
            </h3>
            {insights ? (
              <div className="flex flex-col gap-3">
                {insights.conversation_summary && (
                  <div className="rounded-xl bg-accent-soft/40 p-4 border border-accent/10">
                    <span className="text-[10px] uppercase font-bold text-accent tracking-wider block mb-1">Session Summary</span>
                    <p className="text-sm text-fg leading-relaxed">{insights.conversation_summary}</p>
                  </div>
                )}
                <div className="flex flex-col gap-2 mt-1">
                  <span className="text-[10px] uppercase font-bold text-muted tracking-wider">Key Details Tracked</span>
                  <div className="flex flex-wrap gap-2">
                    {insights.exam_subject && (
                      <span className="rounded-full bg-primary-soft text-primary px-3 py-1 text-xs font-medium border border-primary/20">
                        📚 Exam: <strong className="capitalize">{insights.exam_subject}</strong>
                      </span>
                    )}
                    {insights.relationship_entity && (
                      <span className="rounded-full bg-surface-2 text-muted px-3 py-1 text-xs font-medium border border-border">
                        👥 Discussing: <strong className="capitalize">{insights.relationship_entity}</strong>
                      </span>
                    )}
                    {activeTopicName && (
                      <span className="rounded-full bg-accent-soft text-accent px-3 py-1 text-xs font-medium border border-accent/20">
                        🏷️ Focus: <strong>{activeTopicName}</strong>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-muted flex flex-col items-center gap-2">
                <span className="text-xl">💡</span>
                <p>As we chat, I'll pin key topics and session summaries here to track your wellness journey.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  )
}
