import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users,
  Shield,
  Activity,
  Megaphone,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Server,
  UserCheck,
  Search,
  Check,
  AlertCircle,
  Loader2,
  Trash2,
  Lock,
  Pause,
  MessageSquare,
  Star,
  RefreshCw,
} from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'
import {
  getAdminStats,
  getAdminUsers,
  actionUserAccount,
  createBroadcast,
  stopBroadcast,
  getPlatformHealth,
  getAdminFeedback,
} from '../lib/api.js'
import { db } from '../lib/firebase.js'
import { collection, query, where, onSnapshot } from 'firebase/firestore'

// Simple Toast helper
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [onClose])

  const bgClass =
    type === 'error'
      ? 'bg-danger border-danger/30 text-white'
      : 'bg-primary border-primary/30 text-primary-fg'

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 shadow-lg ${bgClass}`}
    >
      <CheckCircle className="h-4 w-4 shrink-0" />
      <span className="text-xs font-semibold">{message}</span>
    </motion.div>
  )
}

// Confirmation modal for destructive actions
function ConfirmationModal({ isOpen, title, message, confirmLabel, onConfirm, onCancel, isProcessing }) {
  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="card max-w-md w-full p-6 border border-border/80 bg-surface shadow-2xl flex flex-col gap-4"
        >
          <div className="flex items-center gap-2 text-danger">
            <AlertTriangle className="h-5 w-5" />
            <h3 className="text-base font-extrabold text-fg">{title}</h3>
          </div>
          <p className="text-xs text-muted leading-relaxed">{message}</p>
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={onCancel}
              disabled={isProcessing}
              className="btn btn-secondary text-xs px-4 py-2 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isProcessing}
              className="btn bg-danger text-white border-none text-xs px-4 py-2 cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              {isProcessing && <Loader2 className="h-3 w-3 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('overview')
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [feedback, setFeedback] = useState([])
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Toast notifications state
  const [toasts, setToasts] = useState([])
  const addToast = (message, type = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
  }

  // Action confirmations modal state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: '',
    action: null,
  })
  const [processingAction, setProcessingAction] = useState(false)

  // Search & Filters state
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [verificationFilter, setVerificationFilter] = useState('all')
  const [userPage, setUserPage] = useState(1)
  const usersPerPage = 8

  // Announcement state
  const [announcement, setAnnouncement] = useState({ message: '', type: 'info', target: 'all' })
  const [broadcastLoading, setBroadcastLoading] = useState(false)
  const [activeBroadcasts, setActiveBroadcasts] = useState([])
  const [stoppingBroadcastId, setStoppingBroadcastId] = useState(null)

  // Load all platform info
  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [statsData, usersData, feedbackData, healthData] = await Promise.all([
        getAdminStats(),
        getAdminUsers(),
        getAdminFeedback(),
        getPlatformHealth(),
      ])
      setStats(statsData)
      setUsers(usersData.users)
      setFeedback(feedbackData.feedbacks)
      setHealth(healthData)
    } catch (err) {
      console.error('[Admin] failed to load dashboard stats:', err)
      setError(err.message || 'Failed to load administration workspace.')
    } finally {
      setLoading(false)
    }
  };

  useEffect(() => {
    loadData()
  }, [])

  // Subscribe to active broadcasts in real-time
  useEffect(() => {
    const q = query(collection(db, 'broadcasts'), where('active', '==', true))
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      items.sort((a, b) => b.createdAt - a.createdAt)
      setActiveBroadcasts(items)
    }, (err) => {
      console.error('[AdminDashboard] failed to subscribe to broadcasts:', err)
    })
    return unsub
  }, [])

  // Action on user accounts
  const triggerUserAction = (uid, actionName, userName) => {
    let title = ''
    let message = ''
    let confirmLabel = ''

    if (actionName === 'approve') {
      title = 'Approve Clinician License'
      message = `Are you sure you want to verify and activate the medical credentials for clinician ${userName}? This will permit access to clinical tools.`
      confirmLabel = 'Approve Clinician'
    } else if (actionName === 'suspend') {
      title = 'Suspend Clinician Profile'
      message = `Are you sure you want to suspend clinician ${userName}? This will revoke their verification and block them from consulting patients.`
      confirmLabel = 'Suspend Clinician'
    } else if (actionName === 'reject') {
      title = 'Reject Verification Request'
      message = `Are you sure you want to reject clinician ${userName}? This will decline their verification application.`
      confirmLabel = 'Reject Application'
    } else if (actionName === 'disable') {
      title = 'Disable Account'
      message = `Are you sure you want to disable the user profile for ${userName}? They will be completely locked out from the portal.`
      confirmLabel = 'Disable Account'
    }

    setConfirmModal({
      isOpen: true,
      title,
      message,
      confirmLabel,
      action: async () => {
        setProcessingAction(true)
        try {
          await actionUserAccount(uid, actionName)
          addToast(`Successfully completed action '${actionName}' for ${userName}!`)
          // Reload database states
          await loadData()
        } catch (err) {
          addToast(err.message || 'Operation failed', 'error')
        } finally {
          setProcessingAction(false)
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        }
      },
    })
  }

  // Handle Dispatch Broadcast
  const handleSendBroadcast = async (e) => {
    e.preventDefault()
    if (!announcement.message.trim()) return
    setBroadcastLoading(true)
    try {
      await createBroadcast(announcement.message, announcement.type, announcement.target)
      addToast(`Annoucement broadcasted to target: ${announcement.target}!`)
      setAnnouncement({ message: '', type: 'info', target: 'all' })
    } catch (err) {
      addToast(err.message || 'Failed to broadcast announcement.', 'error')
    } finally {
      setBroadcastLoading(false)
    }
  }

  // Handle Stop Broadcast
  const handleStopBroadcast = async (broadcastId) => {
    setStoppingBroadcastId(broadcastId)
    try {
      await stopBroadcast(broadcastId)
      addToast('Announcement stopped and deactivated.')
    } catch (err) {
      addToast(err.message || 'Failed to deactivate announcement.', 'error')
    } finally {
      setStoppingBroadcastId(null)
    }
  }

  // Filters calculation
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchSearch =
        (u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.uid.includes(searchQuery)
      const matchRole = roleFilter === 'all' || u.role === roleFilter
      const matchVerify =
        verificationFilter === 'all' ||
        (verificationFilter === 'verified' && u.verified === true) ||
        (verificationFilter === 'unverified' && u.verified === false) ||
        (verificationFilter === 'pending' && u.role === 'doctor' && u.verified === false && u.status !== 'suspended' && u.status !== 'disabled')
      return matchSearch && matchRole && matchVerify
    })
  }, [users, searchQuery, roleFilter, verificationFilter])

  // Pagination calculation
  const paginatedUsers = useMemo(() => {
    const start = (userPage - 1) * usersPerPage
    return filteredUsers.slice(start, start + usersPerPage)
  }, [filteredUsers, userPage])

  const totalPages = Math.ceil(filteredUsers.length / usersPerPage) || 1

  // Keep pagination bounded
  useEffect(() => {
    if (userPage > totalPages) {
      setUserPage(totalPages)
    }
  }, [totalPages, userPage])

  if (loading) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-6xl px-5 py-10 flex-1">
          <div className="flex items-center justify-between border-b border-border/80 pb-6">
            <div>
              <div className="h-6 w-48 bg-surface-3 animate-pulse rounded-md"></div>
              <div className="h-4 w-72 bg-surface-3 animate-pulse rounded-md mt-2"></div>
            </div>
            <div className="h-9 w-24 bg-surface-3 animate-pulse rounded-xl"></div>
          </div>
          {/* Skeleton KPI Grid */}
          <div className="grid grid-cols-2 gap-4 mt-8 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="card p-5 border border-border/60 bg-surface-2 animate-pulse flex flex-col gap-2">
                <div className="h-4 w-20 bg-surface-3 rounded-md"></div>
                <div className="h-7 w-12 bg-surface-3 rounded-md"></div>
              </div>
            ))}
          </div>
          {/* Skeleton Body */}
          <div className="card border border-border/60 bg-surface-2 animate-pulse mt-8 p-6 h-80 rounded-2xl"></div>
        </div>
      </PageTransition>
    )
  }

  if (error) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-lg px-5 py-20 text-center flex-1">
          <div className="card p-8 border border-danger/20 bg-danger-soft/10 flex flex-col items-center gap-4">
            <AlertCircle className="h-10 w-10 text-danger" />
            <h1 className="text-lg font-bold text-fg">Failed to Load Dashboard</h1>
            <p className="text-xs text-muted leading-relaxed">{error}</p>
            <button onClick={loadData} className="btn bg-primary text-primary-fg hover:bg-primary/95 text-xs px-4 py-2 mt-2">
              Retry Connection
            </button>
          </div>
        </div>
      </PageTransition>
    )
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-6xl px-5 py-8 flex-grow">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-6 mb-8">
          <div>
            <h1 className="text-2xl font-black text-fg tracking-tight flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Shield className="h-4 w-4" />
              </span>
              Administrative Console
            </h1>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              Verify clinicians, monitor system-wide services health, send critical broadcasts, and view analytics.
            </p>
          </div>
          <button
            onClick={loadData}
            className="btn btn-secondary text-xs px-4 py-2 cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh Portal
          </button>
        </div>

        {/* Tab switchers */}
        <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto py-1">
          {[
            { id: 'overview', label: 'Overview & Analytics', icon: Users },
            { id: 'directory', label: 'Clinicians & Users', icon: UserCheck },
            { id: 'health', label: 'Health Monitor', icon: Activity },
            { id: 'broadcast', label: 'Broadcast Suite', icon: Megaphone },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`relative rounded-t-lg px-4 py-2 text-xs font-semibold cursor-pointer transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === t.id ? 'text-primary' : 'text-muted hover:text-fg'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {activeTab === t.id && (
                <motion.div
                  layoutId="admin-active-tab-line"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                />
              )}
            </button>
          ))}
        </div>

        {/* Tab contents */}
        <div className="min-h-[45vh]">
          {/* TAB 1: Overview & Analytics */}
          {activeTab === 'overview' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-8">
              {/* KPI metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card p-5 border border-border bg-surface flex flex-col gap-1.5 shadow-sm">
                  <span className="text-xxs uppercase tracking-wider text-muted font-bold">Total Patients</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-fg">{stats?.total_patients || 0}</span>
                    <span className="text-xxs text-primary font-bold bg-primary-soft/50 px-1.5 py-0.5 rounded">Active</span>
                  </div>
                </div>
                <div className="card p-5 border border-border bg-surface flex flex-col gap-1.5 shadow-sm">
                  <span className="text-xxs uppercase tracking-wider text-muted font-bold">Verified Doctors</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-fg">{stats?.verified_doctors || 0}</span>
                    <span className="text-xxs text-primary font-bold bg-primary-soft/50 px-1.5 py-0.5 rounded">Active</span>
                  </div>
                </div>
                <div className="card p-5 border border-border bg-surface flex flex-col gap-1.5 shadow-sm">
                  <span className="text-xxs uppercase tracking-wider text-muted font-bold">Pending Approval</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-fg">{stats?.unverified_doctors || 0}</span>
                    {stats?.unverified_doctors > 0 && (
                      <span className="text-xxs text-warning font-bold bg-warning-soft px-1.5 py-0.5 rounded animate-pulse">Action Required</span>
                    )}
                  </div>
                </div>
                <div className="card p-5 border border-border bg-surface flex flex-col gap-1.5 shadow-sm">
                  <span className="text-xxs uppercase tracking-wider text-muted font-bold">Appointments booked</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-fg">{stats?.total_appointments || 0}</span>
                    <span className="text-xxs text-muted font-semibold">Scheduled</span>
                  </div>
                </div>
              </div>

              {/* Core Analytics Details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Visual Chart - Signups & Appointments */}
                <div className="card md:col-span-2 p-6 border border-border bg-surface-2 flex flex-col gap-4">
                  <div>
                    <h3 className="font-extrabold text-fg text-sm">Engagement Overview</h3>
                    <p className="text-xxs text-muted">A representation of registered user ratios and wellness document totals.</p>
                  </div>
                  {/* Inline Premium SVG Chart representing ratios */}
                  <div className="relative h-48 w-full flex items-end justify-around border-b border-border/80 pb-2">
                    {/* Patients bar */}
                    <div className="flex flex-col items-center gap-1.5 w-16">
                      <div className="text-xxs font-bold text-fg mb-1">{stats?.total_patients || 0}</div>
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.min(100, Math.max(15, ((stats?.total_patients || 0) / ((stats?.total_patients || 1) + (stats?.total_doctors || 1))) * 140))}px` }}
                        className="w-full bg-gradient-to-t from-primary/80 to-primary rounded-t-lg shadow"
                      />
                      <span className="text-xxs font-bold text-muted">Patients</span>
                    </div>
                    {/* Doctors bar */}
                    <div className="flex flex-col items-center gap-1.5 w-16">
                      <div className="text-xxs font-bold text-fg mb-1">{stats?.total_doctors || 0}</div>
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.min(100, Math.max(15, ((stats?.total_doctors || 0) / ((stats?.total_patients || 1) + (stats?.total_doctors || 1))) * 140))}px` }}
                        className="w-full bg-gradient-to-t from-accent/80 to-accent rounded-t-lg shadow"
                      />
                      <span className="text-xxs font-bold text-muted">Clinicians</span>
                    </div>
                    {/* Journal sheets bar */}
                    <div className="flex flex-col items-center gap-1.5 w-16">
                      <div className="text-xxs font-bold text-fg mb-1">{stats?.total_journals || 0}</div>
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.min(130, Math.max(15, (stats?.total_journals || 0) * 12))}px` }}
                        className="w-full bg-gradient-to-t from-teal-500/80 to-teal-400 rounded-t-lg shadow"
                      />
                      <span className="text-xxs font-bold text-muted">Journals</span>
                    </div>
                    {/* CBT Exercise sheets bar */}
                    <div className="flex flex-col items-center gap-1.5 w-16">
                      <div className="text-xxs font-bold text-fg mb-1">{stats?.total_cbt_exercises || 0}</div>
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.min(130, Math.max(15, (stats?.total_cbt_exercises || 0) * 12))}px` }}
                        className="w-full bg-gradient-to-t from-indigo-500/80 to-indigo-400 rounded-t-lg shadow"
                      />
                      <span className="text-xxs font-bold text-muted">CBT Worksheets</span>
                    </div>
                  </div>
                </div>

                {/* Appointment Status distribution card */}
                <div className="card p-6 border border-border bg-surface flex flex-col gap-4 justify-between">
                  <div>
                    <h3 className="font-extrabold text-fg text-sm">Appointments Status</h3>
                    <p className="text-xxs text-muted mb-4">Verification status of consult routes.</p>
                    <div className="space-y-3">
                      {['pending', 'approved', 'completed', 'cancelled'].map((st) => {
                        const count = stats?.appointments_by_status?.[st] || 0
                        const pct = stats?.total_appointments > 0 ? (count / stats.total_appointments) * 100 : 0
                        return (
                          <div key={st} className="flex flex-col gap-1">
                            <div className="flex justify-between text-xxs font-bold">
                              <span className="capitalize text-muted">{st}</span>
                              <span className="text-fg">{count}</span>
                            </div>
                            <div className="h-1.5 w-full bg-surface-3 rounded-full overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${pct}%` }}></div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {stats?.total_appointments === 0 && (
                    <div className="text-xxs text-center text-muted border border-dashed border-border p-4 rounded-xl">
                      No appointment metrics recorded yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Feedback and Reviews Section */}
              <div className="card p-6 border border-border bg-surface-2 flex flex-col gap-4">
                <div>
                  <h3 className="font-extrabold text-fg text-sm">Feedback &amp; Patient Reviews</h3>
                  <p className="text-xxs text-muted">Reviews filed by patients on doctor consultations.</p>
                </div>
                {feedback.length === 0 ? (
                  <div className="border border-dashed border-border p-8 text-center text-xs text-muted rounded-xl bg-surface">
                    No doctor reviews have been submitted by patients yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {feedback.map((fb) => (
                      <div key={fb.id} className="card p-4 border border-border bg-surface flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xxs font-bold text-muted">Patient ID: {fb.patientId.slice(0, 8)}...</span>
                          <div className="flex items-center text-yellow-500 gap-0.5">
                            {[...Array(5)].map((_, i) => (
                              <Star
                                key={i}
                                className={`h-3 w-3 ${i < fb.rating ? 'fill-current' : 'text-border'}`}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-fg leading-relaxed">"{fb.comment || 'No comment provided.'}"</p>
                        <div className="text-xxs text-faint border-t border-border/40 pt-1.5 mt-1">
                          Doctor UID: {fb.doctorId.slice(0, 8)}...
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 2: Clinicians & User Directory */}
          {activeTab === 'directory' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
              {/* Directory Filter controls */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="relative flex-grow max-w-md">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                  <input
                    type="text"
                    placeholder="Search name, email, or user ID..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setUserPage(1)
                    }}
                    className="w-full pl-10 pr-4 py-2 border border-border bg-surface-2 rounded-xl text-xs outline-none focus:border-primary focus:bg-surface"
                  />
                </div>
                {/* Dropdowns */}
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xxs uppercase tracking-wider text-muted font-bold">Role</label>
                    <select
                      value={roleFilter}
                      onChange={(e) => {
                        setRoleFilter(e.target.value)
                        setUserPage(1)
                      }}
                      className="border border-border bg-surface-2 text-xs rounded-lg px-2.5 py-1.5 outline-none"
                    >
                      <option value="all">All Roles</option>
                      <option value="patient">Patients</option>
                      <option value="doctor">Clinicians</option>
                      <option value="admin">Administrators</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xxs uppercase tracking-wider text-muted font-bold">Status</label>
                    <select
                      value={verificationFilter}
                      onChange={(e) => {
                        setVerificationFilter(e.target.value)
                        setUserPage(1)
                      }}
                      className="border border-border bg-surface-2 text-xs rounded-lg px-2.5 py-1.5 outline-none"
                    >
                      <option value="all">All Verification Statuses</option>
                      <option value="verified">Verified</option>
                      <option value="unverified">Unverified</option>
                      <option value="pending">Verification Pending</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* User list directory table */}
              <div className="card border border-border bg-surface-2 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface-3/50 font-bold text-muted">
                        <th className="p-4">Name / Email</th>
                        <th className="p-4">User ID</th>
                        <th className="p-4">Role</th>
                        <th className="p-4">Status / Verification</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedUsers.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="p-12 text-center text-muted font-semibold bg-surface">
                            No directory matches found.
                          </td>
                        </tr>
                      ) : (
                        paginatedUsers.map((u) => (
                          <tr key={u.uid} className="border-b border-border bg-surface hover:bg-surface-3/15">
                            <td className="p-4">
                              <div className="font-bold text-fg">{u.name || 'Anonymous User'}</div>
                              <div className="text-xxs text-muted">{u.email || '—'}</div>
                            </td>
                            <td className="p-4 text-xxs text-muted font-mono">{u.uid}</td>
                            <td className="p-4">
                              <span
                                className={`px-2 py-0.5 rounded-full text-xxs font-extrabold capitalize ${
                                  u.role === 'admin'
                                    ? 'bg-purple-soft text-purple'
                                    : u.role === 'doctor'
                                      ? 'bg-accent-soft text-accent'
                                      : 'bg-primary-soft text-primary'
                                }`}
                              >
                                {u.role}
                              </span>
                            </td>
                            <td className="p-4">
                              {u.role === 'doctor' ? (
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1">
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${
                                        u.verified ? 'bg-primary' : 'bg-warning animate-pulse'
                                      }`}
                                    />
                                    <span className={`font-bold capitalize ${u.verified ? 'text-primary' : 'text-warning'}`}>
                                      {u.verified ? 'Verified' : 'Pending Verification'}
                                    </span>
                                  </div>
                                  {u.status && u.status !== 'active' && (
                                    <span className="text-xxs text-danger font-semibold uppercase">({u.status})</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted text-xxs capitalize">{u.status || 'Active'}</span>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              {u.role === 'doctor' ? (
                                <div className="flex justify-end gap-1.5">
                                  {!u.verified ? (
                                    <>
                                      <button
                                        onClick={() => triggerUserAction(u.uid, 'approve', u.name)}
                                        className="btn bg-primary-soft text-primary border-primary/20 text-xxs px-2.5 py-1 flex items-center gap-1 cursor-pointer hover:bg-primary hover:text-white transition"
                                      >
                                        <Check className="h-3 w-3" /> Approve
                                      </button>
                                      <button
                                        onClick={() => triggerUserAction(u.uid, 'reject', u.name)}
                                        className="btn bg-danger-soft text-danger border-danger/20 text-xxs px-2.5 py-1 flex items-center gap-1 cursor-pointer hover:bg-danger hover:text-white transition"
                                      >
                                        <XCircle className="h-3 w-3" /> Reject
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => triggerUserAction(u.uid, 'suspend', u.name)}
                                      className="btn bg-warning-soft text-warning border-warning/20 text-xxs px-2.5 py-1 flex items-center gap-1 cursor-pointer hover:bg-warning hover:text-white transition"
                                    >
                                      <Pause className="h-3 w-3" /> Suspend
                                    </button>
                                  )}
                                  {u.status !== 'disabled' ? (
                                    <button
                                      onClick={() => triggerUserAction(u.uid, 'disable', u.name)}
                                      className="btn border-border text-xxs px-2 py-1 flex items-center gap-1 cursor-pointer hover:border-danger hover:text-danger text-muted transition"
                                    >
                                      <Lock className="h-3 w-3" /> Disable
                                    </button>
                                  ) : (
                                    <span className="text-xxs font-bold text-danger bg-danger-soft px-2 py-1 rounded">Disabled</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xxs text-muted font-semibold">Self-Care Access Only</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Table Pagination */}
                {totalPages > 1 && (
                  <div className="flex justify-between items-center bg-surface-3/30 p-4 border-t border-border">
                    <span className="text-xxs text-muted font-semibold">
                      Showing {(userPage - 1) * usersPerPage + 1} - {Math.min(userPage * usersPerPage, filteredUsers.length)} of {filteredUsers.length} entries
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setUserPage((p) => Math.max(1, p - 1))}
                        disabled={userPage === 1}
                        className="btn btn-secondary text-xxs px-2.5 py-1.5 cursor-pointer disabled:opacity-50"
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setUserPage((p) => Math.min(totalPages, p + 1))}
                        disabled={userPage === totalPages}
                        className="btn btn-secondary text-xxs px-2.5 py-1.5 cursor-pointer disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 3: Health Monitor */}
          {activeTab === 'health' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-fg text-sm">Ecosystem Services Status</h3>
                  <p className="text-xxs text-muted">A real-time health indicator check of key backend systems.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary animate-ping"></span>
                  <span className="text-xxs font-bold text-primary">Live Monitor Connected</span>
                </div>
              </div>

              {/* Service Health Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {/* 1. FastAPI backend */}
                <div className="card p-5 border border-border bg-surface flex flex-col gap-3 shadow-sm justify-between">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <span className="text-xxs uppercase tracking-wider text-muted font-bold">API Backend</span>
                    <Server className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <span className="text-base font-black text-primary uppercase">Healthy</span>
                    <div className="text-xxs text-muted mt-1 font-semibold">FastAPI REST Server</div>
                  </div>
                </div>

                {/* 2. Firestore */}
                <div className="card p-5 border border-border bg-surface flex flex-col gap-3 shadow-sm justify-between">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <span className="text-xxs uppercase tracking-wider text-muted font-bold">Firestore DB</span>
                    <Server className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <span
                      className={`text-base font-black uppercase ${
                        health?.firestore?.status === 'healthy' ? 'text-primary' : 'text-danger'
                      }`}
                    >
                      {health?.firestore?.status}
                    </span>
                    <div className="text-xxs text-muted mt-1 font-semibold">
                      Latency: {health?.firestore?.latency_ms ? `${health.firestore.latency_ms} ms` : '—'}
                    </div>
                  </div>
                </div>

                {/* 3. Agora Video */}
                <div className="card p-5 border border-border bg-surface flex flex-col gap-3 shadow-sm justify-between">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <span className="text-xxs uppercase tracking-wider text-muted font-bold">Agora Video</span>
                    <Server className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <span
                      className={`text-base font-black uppercase ${
                        health?.video_service?.status === 'healthy'
                          ? 'text-primary'
                          : health?.video_service?.status === 'degraded'
                            ? 'text-warning'
                            : 'text-danger'
                      }`}
                    >
                      {health?.video_service?.status}
                    </span>
                    <div className="text-xxs text-muted mt-1 font-semibold leading-tight">
                      {health?.video_service?.details || 'Video channel token status'}
                    </div>
                  </div>
                </div>

                {/* 4. AI chatbot NLP */}
                <div className="card p-5 border border-border bg-surface flex flex-col gap-3 shadow-sm justify-between">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <span className="text-xxs uppercase tracking-wider text-muted font-bold">AI Chat Engine</span>
                    <Server className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <span
                      className={`text-base font-black uppercase ${
                        health?.ai_service?.status === 'healthy' ? 'text-primary' : 'text-danger'
                      }`}
                    >
                      {health?.ai_service?.status}
                    </span>
                    <div className="text-xxs text-muted mt-1 font-semibold leading-tight">
                      {health?.ai_service?.details || 'Knowledge base analyzer readiness'}
                    </div>
                  </div>
                </div>
              </div>

              {/* WebSocket connection metrics */}
              <div className="card p-6 border border-border bg-surface-2 flex flex-col gap-4">
                <div>
                  <h3 className="font-extrabold text-fg text-sm">Active WebSockets</h3>
                  <p className="text-xxs text-muted">Concurrent client connections established for real-time safety gating.</p>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-black text-fg">{health?.active_websockets || 0}</span>
                  <span className="text-xxs font-bold text-primary bg-primary-soft/40 px-2 py-0.5 rounded">
                    Active channels
                  </span>
                </div>
                <div className="h-2 w-full bg-surface-3 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.min(100, ((health?.active_websockets || 0) / 50) * 100)}%` }}
                  />
                </div>
                <p className="text-xxs text-muted">
                  Max capacity monitored up to 50 active channels before routing warnings trigger.
                </p>
              </div>
            </motion.div>
          )}

          {/* TAB 4: Broadcast Suite */}
          {activeTab === 'broadcast' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Form to launch broadcast */}
              <div className="card md:col-span-2 p-6 border border-border bg-surface-2 flex flex-col gap-4">
                <div>
                  <h3 className="font-extrabold text-fg text-sm">Global Announcement Broadcast</h3>
                  <p className="text-xxs text-muted">Dispatch warnings or maintenance alerts targeting system-wide users.</p>
                </div>
                <form onSubmit={handleSendBroadcast} className="flex flex-col gap-4 mt-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xxs uppercase tracking-wider text-muted font-bold">Broadcast Message</label>
                    <textarea
                      value={announcement.message}
                      onChange={(e) => setAnnouncement((prev) => ({ ...prev, message: e.target.value }))}
                      placeholder="Enter the notification content (e.g. Server maintenance scheduled today at 9:00 PM UTC)..."
                      required
                      className="border border-border bg-surface text-xs rounded-xl p-3 outline-none focus:border-primary min-h-[80px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xxs uppercase tracking-wider text-muted font-bold">Notice Type</label>
                      <select
                        value={announcement.type}
                        onChange={(e) => setAnnouncement((prev) => ({ ...prev, type: e.target.value }))}
                        className="border border-border bg-surface text-xs rounded-xl px-3 py-2 outline-none"
                      >
                        <option value="info">Information (Blue)</option>
                        <option value="warning">Critical Alert (Yellow)</option>
                        <option value="maintenance">Maintenance Block (Red)</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xxs uppercase tracking-wider text-muted font-bold">Target Audience</label>
                      <select
                        value={announcement.target}
                        onChange={(e) => setAnnouncement((prev) => ({ ...prev, target: e.target.value }))}
                        className="border border-border bg-surface text-xs rounded-xl px-3 py-2 outline-none"
                      >
                        <option value="all">All Users (Doctors &amp; Patients)</option>
                        <option value="doctors">Clinicians Only</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={broadcastLoading}
                    className="btn bg-primary text-primary-fg hover:bg-primary/95 text-xs py-2.5 font-bold cursor-pointer flex items-center justify-center gap-1.5 self-end px-5 mt-2 disabled:opacity-50"
                  >
                    {broadcastLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Dispatch Broadcast
                  </button>
                </form>
              </div>

              {/* Sidebar: Active Broadcasts & Guidelines */}
              <div className="flex flex-col gap-6">
                {/* Active Announcements */}
                <div className="card p-6 border border-border bg-surface-2 flex flex-col gap-4">
                  <div>
                    <h4 className="font-bold text-fg text-xs uppercase tracking-wider border-b border-border/40 pb-1.5 flex items-center justify-between">
                      <span>Active Broadcasts</span>
                      {activeBroadcasts.length > 0 && (
                        <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full text-[10px] font-extrabold">
                          {activeBroadcasts.length}
                        </span>
                      )}
                    </h4>
                  </div>
                  
                  {activeBroadcasts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-border/60 rounded-xl bg-surface">
                      <Megaphone className="h-6 w-6 text-muted/40 animate-pulse mb-1.5" />
                      <p className="text-xxs font-semibold text-muted">No active broadcasts</p>
                      <p className="text-[10px] text-faint max-w-[150px] mt-0.5 leading-relaxed">Dispatched alerts will appear here in real-time.</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                      {activeBroadcasts.map((b) => {
                        const isStopping = stoppingBroadcastId === b.id
                        const timeStr = b.createdAt ? new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
                        
                        let cardColorClass = 'border-l-4 border-primary bg-primary/5 text-fg'
                        let typeLabel = 'Info'
                        if (b.type === 'warning') {
                          cardColorClass = 'border-l-4 border-warning bg-warning/5 text-fg'
                          typeLabel = 'Warning'
                        } else if (b.type === 'maintenance') {
                          cardColorClass = 'border-l-4 border-danger bg-danger/5 text-fg'
                          typeLabel = 'Maintenance'
                        }

                        return (
                          <div key={b.id} className={`p-3 rounded-xl border border-border/60 flex items-start justify-between gap-2 transition hover:shadow-sm ${cardColorClass}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                <span className="text-[10px] font-extrabold uppercase tracking-wide">
                                  {typeLabel}
                                </span>
                                <span className="text-[9px] text-muted font-medium bg-surface/80 px-1.5 py-0.2 rounded border border-border/40">
                                  To: {b.target === 'all' ? 'All' : 'Clinicians'}
                                </span>
                                {timeStr && (
                                  <span className="text-[9px] text-faint ml-auto">
                                    {timeStr}
                                  </span>
                                )}
                              </div>
                              <p className="text-xxs text-fg/90 font-medium break-words leading-relaxed select-text">
                                {b.message}
                              </p>
                            </div>
                            
                            <button
                              onClick={() => handleStopBroadcast(b.id)}
                              disabled={isStopping || stoppingBroadcastId !== null}
                              title="Stop this broadcast"
                              className="text-muted hover:text-danger hover:bg-danger/10 p-1 rounded-lg transition shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              {isStopping ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Notice Guidelines */}
                <div className="card p-6 border border-border bg-surface flex flex-col gap-3">
                  <div>
                    <h4 className="font-bold text-fg text-xs uppercase tracking-wider border-b border-border/40 pb-1.5 mb-2">
                      Notice Guidelines
                    </h4>
                    <ul className="space-y-2.5 text-xxs text-muted leading-relaxed list-disc pl-4">
                      <li>Announcements are synchronized in real-time across active browser tabs.</li>
                      <li>
                        <span className="font-semibold text-fg">Critical Alerts</span> are displayed as prominent yellow banners.
                      </li>
                      <li>
                        <span className="font-semibold text-fg">Maintenance Blocks</span> show red alert banners.
                      </li>
                    </ul>
                  </div>
                  <div className="text-xxs text-muted border border-dashed border-border p-3 rounded-lg leading-relaxed bg-surface-2">
                    Note: Broadcast records are saved inside the database collection `broadcasts` for analytical audits.
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Confirmation Modals & Toast notifications */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmLabel={confirmModal.confirmLabel}
        onConfirm={confirmModal.action}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        isProcessing={processingAction}
      />

      <AnimatePresence>
        {toasts.map((t) => (
          <Toast
            key={t.id}
            message={t.message}
            type={t.type}
            onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          />
        ))}
      </AnimatePresence>
    </PageTransition>
  )
}
