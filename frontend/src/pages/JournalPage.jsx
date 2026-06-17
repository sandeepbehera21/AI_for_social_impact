import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Plus,
  Search,
  Trash2,
  Calendar,
  Save,
  Tag,
  Smile,
  BarChart3,
  Loader2,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react'
import { db } from '../lib/firebase.js'
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { useAuth } from '../context/AuthContext.jsx'
import PageTransition from '../components/PageTransition.jsx'
import { EMOTIONS, EMOTION_META } from '../lib/moodHistory.js'
import { sanitizeInput } from '../lib/sanitize.js'

const TOPICS = [
  'career',
  'job',
  'internship',
  'exams',
  'placements',
  'studies',
  'family',
  'relationships',
  'health',
  'finances',
  'loneliness',
  'sleep',
  'social',
  'addiction',
  'panic',
  'grief',
  'general'
]

export default function JournalPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  // ── State ─────────────────────────────────────────────────────────────────
  const [journals, setJournals] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(null) // selected entry to edit/view

  // Form Fields
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [emotion, setEmotion] = useState('Neutral')
  const [topic, setTopic] = useState('general')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  // Search & Filters
  const [search, setSearch] = useState('')
  const [filterEmotion, setFilterEmotion] = useState('all')
  const [filterTopic, setFilterTopic] = useState('all')

  // ── Fetch journals ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.uid) return
    const q = query(
      collection(db, 'journals'),
      where('patientId', '==', profile.uid)
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        list.sort((a, b) => (b.ts || 0) - (a.ts || 0))
        setJournals(list)
        setLoading(false)
      },
      (err) => {
        console.error('Journal subscription error:', err)
        setLoading(false)
      }
    )
    return unsub
  }, [profile?.uid])

  // Select active entry to populate form
  const activeEntry = useMemo(() => {
    return journals.find((j) => j.id === activeId) || null
  }, [journals, activeId])

  useEffect(() => {
    if (activeEntry) {
      setTitle(activeEntry.title || '')
      setContent(activeEntry.content || '')
      setEmotion(activeEntry.emotion || 'Neutral')
      setTopic(activeEntry.topic || 'general')
    } else {
      // Clear form for new entry
      setTitle('')
      setContent('')
      setEmotion('Neutral')
      setTopic('general')
    }
    setNotice(null)
  }, [activeEntry, activeId])

  // ── Filters & Search ──────────────────────────────────────────────────────
  const filteredJournals = useMemo(() => {
    return journals.filter((j) => {
      const matchSearch =
        (j.title || '').toLowerCase().includes(search.toLowerCase()) ||
        (j.content || '').toLowerCase().includes(search.toLowerCase())

      const matchEmotion = filterEmotion === 'all' || j.emotion === filterEmotion
      const matchTopic = filterTopic === 'all' || j.topic === filterTopic

      return matchSearch && matchEmotion && matchTopic
    })
  }, [journals, search, filterEmotion, filterTopic])

  // ── Analytics ─────────────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    if (journals.length === 0) return null

    const emoCounts = {}
    const topicCounts = {}
    EMOTIONS.forEach((e) => { emoCounts[e] = 0 })
    TOPICS.forEach((t) => { topicCounts[t] = 0 })

    journals.forEach((j) => {
      if (EMOTIONS.includes(j.emotion)) emoCounts[j.emotion]++
      if (TOPICS.includes(j.topic)) topicCounts[j.topic]++
    })

    const topEmotion = Object.keys(emoCounts).reduce((a, b) =>
      emoCounts[a] > emoCounts[b] ? a : b
    )
    const topTopic = Object.keys(topicCounts).reduce((a, b) =>
      topicCounts[a] > topicCounts[b] ? a : b
    )

    return {
      total: journals.length,
      topEmotion,
      topTopic,
      emoCounts,
      topicCounts,
    }
  }, [journals])

  // ── Save Journal ──────────────────────────────────────────────────────────
  const save = async () => {
    const cleanTitle = sanitizeInput(title)
    const cleanContent = sanitizeInput(content)
    if (!cleanTitle || !cleanContent) {
      setNotice({ type: 'err', text: 'Please fill in both the title and content.' })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      if (activeId) {
        // Update
        const ref = doc(db, 'journals', activeId)
        await updateDoc(ref, {
          title: cleanTitle,
          content: cleanContent,
          emotion,
          topic,
          updatedAt: serverTimestamp(),
        })
        setNotice({ type: 'ok', text: 'Journal entry updated successfully.' })
      } else {
        // Create
        const docRef = await addDoc(collection(db, 'journals'), {
          patientId: profile.uid,
          title: cleanTitle,
          content: cleanContent,
          emotion,
          topic,
          ts: Date.now(),
          createdAt: serverTimestamp(),
        })
        setActiveId(docRef.id)
        setNotice({ type: 'ok', text: 'Journal entry saved successfully.' })
      }
    } catch (err) {
      setNotice({ type: 'err', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  // ── Delete Journal ────────────────────────────────────────────────────────
  const remove = async (id) => {
    if (!window.confirm('Are you sure you want to delete this journal entry?')) return
    try {
      await deleteDoc(doc(db, 'journals', id))
      if (activeId === id) {
        setActiveId(null)
      }
      setNotice({ type: 'ok', text: 'Journal entry deleted.' })
    } catch (err) {
      setNotice({ type: 'err', text: err.message })
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageTransition className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* Back button & Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={() => navigate('/dashboard/patient')}
          className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </button>

        <button
          onClick={() => setActiveId(null)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" /> Write New Entry
        </button>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-accent">Journal Workspace</h1>
        <p className="mt-1 text-sm text-muted">
          Reflect on your daily experiences, tag your emotions, and track your personal growth topics.
        </p>
      </header>

      {/* ── Analytics Block ── */}
      {analytics && (
        <section className="grid gap-4 sm:grid-cols-3 mb-8">
          <div className="card p-4 flex items-center gap-3">
            <BookOpen className="h-8 w-8 text-accent" />
            <div>
              <div className="text-xs text-muted">Total Entries</div>
              <div className="text-xl font-bold text-fg tabular-nums">{analytics.total}</div>
            </div>
          </div>

          <div className="card p-4 flex items-center gap-3">
            <span className="text-3xl">{EMOTION_META[analytics.topEmotion]?.emoji}</span>
            <div>
              <div className="text-xs text-muted">Top Emotion Tag</div>
              <div className="text-xl font-bold text-fg" style={{ color: EMOTION_META[analytics.topEmotion]?.color }}>
                {analytics.topEmotion}
              </div>
            </div>
          </div>

          <div className="card p-4 flex items-center gap-3">
            <Tag className="h-8 w-8 text-success" />
            <div>
              <div className="text-xs text-muted">Frequent Topic</div>
              <div className="text-xl font-bold text-fg capitalize">{analytics.topTopic}</div>
            </div>
          </div>
        </section>
      )}

      {/* Main 2-column workspace */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Side: Entry List & Search */}
        <div className="card flex flex-col p-4 lg:col-span-1 min-h-[320px] lg:h-[600px]">
          <h2 className="mb-4 text-base font-bold text-fg flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-accent" /> Past Reflections
          </h2>

          {/* Search bar */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-faint" />
            <input
              type="text"
              placeholder="Search journals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 py-2 text-xs text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div>
              <label className="mb-1 block text-[10px] text-muted font-medium">Emotion</label>
              <select
                value={filterEmotion}
                onChange={(e) => setFilterEmotion(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All Moods</option>
                {EMOTIONS.map((e) => (
                  <option key={e} value={e}>
                    {EMOTION_META[e].emoji} {e}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-muted font-medium">Topic</label>
              <select
                value={filterTopic}
                onChange={(e) => setFilterTopic(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All Topics</option>
                {TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* List area */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 thin-scroll">
            {loading ? (
              <div className="flex items-center justify-center py-10 gap-2 text-muted text-xs">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading entries...
              </div>
            ) : filteredJournals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-muted">
                <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <BookOpen className="h-6 w-6" />
                </div>
                No entries match your search/filters.
              </div>
            ) : (
              filteredJournals.map((j) => {
                const active = j.id === activeId
                const date = j.ts ? new Date(j.ts).toLocaleDateString() : '—'
                return (
                  <div
                    key={j.id}
                    className={`group relative rounded-xl border p-3.5 text-left transition cursor-pointer ${
                      active
                        ? 'border-primary bg-primary-soft'
                        : 'border-border bg-surface-2 hover:border-border-strong'
                    }`}
                    onClick={() => setActiveId(j.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-fg group-hover:text-primary">
                        {j.title || 'Untitled reflection'}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          remove(j.id)
                        }}
                        className="shrink-0 p-0.5 text-muted transition hover:text-danger [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                        title="Delete entry"
                        aria-label={`Delete ${j.title || 'journal entry'}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <p className="mt-1 line-clamp-2 text-[10px] text-muted">{j.content}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[9px] text-faint">
                      <Calendar className="h-3 w-3 shrink-0" /> {date}
                      <span className="shrink-0">·</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[8px] font-semibold"
                        style={{
                          backgroundColor: `${EMOTION_META[j.emotion]?.color}22`,
                          color: EMOTION_META[j.emotion]?.color,
                        }}
                      >
                        {EMOTION_META[j.emotion]?.emoji} {j.emotion}
                      </span>
                      <span className="shrink-0">·</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[8px] font-semibold text-muted capitalize">
                        {j.topic}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Side: Creator / Editor */}
        <div className="card p-6 lg:col-span-2 flex flex-col min-h-[400px] lg:h-[600px]">
          <h2 className="mb-4 text-base font-bold text-fg flex items-center gap-2">
            <Plus className="h-5 w-5 text-accent" />
            {activeId ? 'Edit Entry' : 'Create Reflection'}
          </h2>

          {notice && (
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
                notice.type === 'ok'
                  ? 'border-primary/40 bg-primary-soft text-primary'
                  : 'border-danger/40 bg-danger-soft text-danger'
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* Form */}
          <div className="space-y-4 flex-1 flex flex-col min-h-0">
            {/* Title */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted">Title</label>
              <input
                type="text"
                placeholder="What is on your mind..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {/* Select tags */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  Tag Emotional State
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {EMOTIONS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setEmotion(e)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
                        emotion === e
                          ? 'font-bold shadow-sm'
                          : 'border border-border hover:border-border-strong text-muted'
                      }`}
                      style={
                        emotion === e
                          ? {
                              backgroundColor: `${EMOTION_META[e].color}25`,
                              color: EMOTION_META[e].color,
                              borderColor: EMOTION_META[e].color,
                              borderWidth: '1px',
                            }
                          : {}
                      }
                    >
                      <span>{EMOTION_META[e].emoji}</span> {e}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  Tag Discussion Topic
                </label>
                <select
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 capitalize"
                >
                  {TOPICS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Content Textarea */}
            <div className="flex-1 flex flex-col min-h-0">
              <label className="mb-1.5 block text-xs font-semibold text-muted">Content</label>
              <textarea
                placeholder="Start writing your thoughts, feelings, and self-reflection here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg placeholder:text-faint outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none thin-scroll"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex gap-3 justify-end border-t border-border pt-4">
            {activeId && (
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="rounded-lg border border-border-strong px-4 py-2 text-xs font-semibold text-muted hover:bg-surface-2"
              >
                New Entry
              </button>
            )}

            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-xs font-bold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              ) : (
                <><Save className="h-4 w-4" /> {activeId ? 'Update Reflection' : 'Save Reflection'}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </PageTransition>
  )
}
