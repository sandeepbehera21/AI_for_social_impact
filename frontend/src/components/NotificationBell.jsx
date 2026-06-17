import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  Trash2,
  Check,
  CheckCheck,
  Brain,
  Moon,
  Calendar,
  Activity,
  LifeBuoy,
  Siren,
  Sparkles
} from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import {
  subscribeNotifications,
  markAsRead,
  deleteNotification
} from '../lib/notifications.js'
import { doc, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase.js'

// Icon selector based on notification type
const getIcon = (type) => {
  switch (type) {
    case 'habit_reminder':
      return <Activity className="h-4 w-4 text-emerald-400" />
    case 'wellness_checkin':
      return <Brain className="h-4 w-4 text-primary" />
    case 'appointment_reminder':
      return <Calendar className="h-4 w-4 text-sky-400" />
    case 'journal_nudge':
      return <Sparkles className="h-4 w-4 text-accent" />
    case 'cbt_reminder':
      return <Brain className="h-4 w-4 text-purple-400" />
    case 'sos_followup':
      return <LifeBuoy className="h-4 w-4 text-danger" />
    case 'crisis':
      return <Siren className="h-4 w-4 text-danger animate-pulse" />
    default:
      return <Bell className="h-4 w-4 text-muted" />
  }
}

// Simple local relative time helper
const formatRelativeTime = (ts) => {
  if (!ts) return ''
  const diff = Date.now() - ts
  const mins = Math.round(diff / 60000)
  const hours = Math.round(diff / 3600000)
  const days = Math.round(diff / 86400000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

export default function NotificationBell() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    if (!profile?.uid) return
    return subscribeNotifications(profile.uid, setNotifications, (err) => {
      console.error('[NotificationBell] error subscribing:', err)
    })
  }, [profile?.uid])

  // Close dropdown on clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  const handleMarkAllRead = async () => {
    if (!notifications.length) return
    try {
      const batch = writeBatch(db)
      notifications.forEach((n) => {
        if (!n.read) {
          batch.update(doc(db, 'notifications', n.id), {
            read: true,
            readAt: Date.now()
          })
        }
      })
      await batch.commit()
    } catch (err) {
      console.error('[NotificationBell] failed to mark all as read:', err)
    }
  }

  const handleNotificationClick = async (n) => {
    if (!n.read) {
      await markAsRead(n.id).catch(console.error)
    }
    setOpen(false)

    // Routing rules
    if (profile?.role === 'doctor') {
      navigate('/doctor/patients')
    } else {
      switch (n.type) {
        case 'habit_reminder':
          navigate('/habits')
          break
        case 'wellness_checkin':
          navigate('/chat')
          break
        case 'appointment_reminder':
          navigate('/consult-doc')
          break
        case 'journal_nudge':
          navigate('/journal')
          break
        case 'cbt_reminder':
          navigate('/cbt')
          break
        case 'sos_followup':
          navigate('/sos')
          break
        default:
          navigate('/dashboard/patient')
      }
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted transition hover:border-primary hover:text-primary hover:bg-surface-2"
        aria-label="Open notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-danger-fg motion-safe:animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Card */}
      {open && (
        <div className="absolute right-0 mt-2 z-50 w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-surface shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-3">
            <span className="text-xs font-bold text-fg">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          {/* List Scroll Area */}
          <div className="max-h-72 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                <Bell className="h-8 w-8 text-faint mb-2" />
                <span className="text-xs font-semibold text-fg/80">All caught up!</span>
                <span className="text-[10px] text-muted mt-0.5">No notifications or reminders right now.</span>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`group relative flex items-start gap-3 p-3.5 text-left transition hover:bg-surface-2 ${
                    !n.read ? 'bg-primary-soft/10' : ''
                  }`}
                >
                  {/* Left Icon */}
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3">
                    {getIcon(n.type)}
                  </span>

                  {/* Text Content */}
                  <button
                    onClick={() => handleNotificationClick(n)}
                    className="flex-1 text-left min-w-0 pr-6"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-fg">{n.title}</span>
                      {!n.read && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="text-[11px] leading-relaxed text-muted mt-0.5 pr-2">
                      {n.detail}
                    </div>
                    <div className="text-[9px] text-faint mt-1">
                      {formatRelativeTime(n.ts)}
                    </div>
                  </button>

                  {/* Actions — always visible at reduced opacity, fully visible on hover/focus for touch support */}
                  <div className="absolute right-2 top-3 flex flex-col gap-1 opacity-40 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {!n.read && (
                      <button
                        onClick={() => markAsRead(n.id).catch(console.error)}
                        className="rounded p-1 bg-surface-3 text-muted hover:text-success hover:bg-success-soft transition"
                        title="Mark as read"
                        aria-label="Mark notification as read"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteNotification(n.id).catch(console.error)}
                      className="rounded p-1 bg-surface-3 text-muted hover:text-danger hover:bg-danger-soft transition"
                      title="Delete"
                      aria-label="Delete notification"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
