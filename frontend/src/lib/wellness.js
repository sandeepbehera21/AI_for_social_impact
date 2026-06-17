/**
 * Personalized wellness engine + data layer (Phase 2).
 *
 * Mirrors backend/app/services/wellness.py: the wellness score, the rule-based
 * recommendation engine, and personalized plan generation all produce the same
 * shapes as the backend so the patient dashboard, chatbot, and doctor view stay
 * consistent. Plans persist to the `wellness_plans` collection (client SDK,
 * guarded by rules); the doctor reads the aggregate through the backend.
 *
 * A plan doc:
 *   { patientId, focus, title, tasks:[{id,label,type,action,done}], signals,
 *     active:true, progress:{ 'YYYY-MM-DD': [taskId,...] }, ts, generatedAt }
 */
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase.js'
import { isoDate } from './habits.js'

// ---------------------------------------------------------------------------
// Signal helpers (operate on the camelCase shapes the frontend already builds)
// ---------------------------------------------------------------------------
function dominantRecentEmotion(moodSummary) {
  if (!moodSummary) return null
  const latest = moodSummary.latest
  if (latest?.dominantEmotion) return latest.dominantEmotion
  const periods = moodSummary.periods || {}
  for (const name of ['weekly', 'monthly', 'daily']) {
    if (periods[name]?.dominant) return periods[name].dominant
  }
  return null
}

function emotionalRisk(moodSummary) {
  if (!moodSummary?.periods) return 0
  return Math.max(0, ...Object.values(moodSummary.periods).map((p) => p.riskScore || 0))
}

function journalTopicCounts(journals) {
  const counts = {}
  for (const j of journals || []) {
    const t = j.topic
    if (t && t !== 'general') counts[t] = (counts[t] || 0) + 1
  }
  return counts
}

const PLACEMENT_TOPICS = new Set(['placements', 'career', 'job', 'internship', 'exams', 'studies'])

const AFFECT_CANON = {
  fear: 'fear', Fear: 'fear',
  sadness: 'sadness', Sad: 'sadness', sad: 'sadness',
  anger: 'anger', Angry: 'anger', angry: 'anger',
}
function canonAffect(label) {
  return label ? AFFECT_CANON[label] || null : null
}

function persistentSadness(moodSummary) {
  if (!moodSummary?.periods) return false
  const windows = Object.entries(moodSummary.periods).filter(
    ([name, p]) => p?.dominant === 'Sad' && (name === 'weekly' || name === 'monthly'),
  ).length
  return windows >= 2
}

// ---------------------------------------------------------------------------
// Wellness score
// ---------------------------------------------------------------------------
export function scoreLevel(score) {
  if (score >= 75) return 'thriving'
  if (score >= 55) return 'steady'
  if (score >= 35) return 'struggling'
  return 'needs_support'
}

export const LEVEL_META = {
  thriving: { label: 'Thriving', color: '#22c55e' },
  steady: { label: 'Steady', color: '#38bdf8' },
  struggling: { label: 'Struggling', color: '#f97316' },
  needs_support: { label: 'Needs Support', color: '#ef4444' },
}

export function computeWellnessScore({ moodSummary, habitSummary, journals, cbt, riskScore = 0 } = {}) {
  const emoRisk = Math.max(Number(riskScore) || 0, emotionalRisk(moodSummary))
  const hasMood = !!(moodSummary && moodSummary.totalSamples)
  const emotional = hasMood ? Math.round((1 - emoRisk) * 100) : 60

  const hasHabits = !!(habitSummary && habitSummary.loggedDays)
  const habit = hasHabits ? Math.round(habitSummary.adherence * 100) : 50

  const nJournal = (journals || []).length
  const nCbt = (cbt || []).length
  const engagement = Math.min(100, nJournal * 8 + nCbt * 12)

  let score = Math.round(0.4 * emotional + 0.4 * habit + 0.2 * engagement)
  score = Math.max(0, Math.min(100, score))
  return {
    score,
    level: scoreLevel(score),
    components: { emotional, habit, engagement },
    hasData: hasMood || hasHabits || nJournal > 0 || nCbt > 0,
  }
}

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------
export function generateRecommendations({
  moodSummary,
  habitSummary,
  journals,
  cbt,
  riskScore = 0,
  facialDistress = 0,
  sentiment = null,
  planAdherence = null,
  prevRecommendations = null,
} = {}) {
  const recs = []
  const emotion = dominantRecentEmotion(moodSummary)
  const emoRisk = emotionalRisk(moodSummary)
  const fusedRisk = Math.max(Number(riskScore) || 0, emoRisk)
  const topics = journalTopicCounts(journals)
  const sent = canonAffect(sentiment)
  const facial = Number(facialDistress) || 0

  const push = (r) => recs.push(r)

  if (emotion === 'Fear' || (emotion === 'Angry' && emoRisk >= 0.4)) {
    push({ id: 'anxiety-worksheet', title: 'Work through an Anxiety Worksheet', detail: 'Your recent check-ins show anxious feelings. Mapping the trigger and a coping plan can steady racing thoughts.', category: 'cbt', action: 'cbt:anxiety', priority: 1, why: 'mood:fear' })
  }
  if (emotion === 'Sad' || emoRisk >= 0.6) {
    push({ id: 'thought-reframing', title: 'Try Thought Reframing', detail: 'Things have felt heavy lately. Identifying cognitive distortions can help reframe negative thoughts.', category: 'cbt', action: 'cbt:reframing', priority: 1, why: 'mood:sadness' })
  }
  if (emotion === 'Angry') {
    push({ id: 'stress-worksheet', title: 'Separate what you can control', detail: 'Frustration builds up fast. A stress worksheet helps you act on what is in your control and let go of what is not.', category: 'cbt', action: 'cbt:stress', priority: 2, why: 'mood:anger' })
  }

  // Facial + NLP sentiment fusion (fires without any mood history)
  if (sent === 'fear' || facial >= 0.6) {
    push({ id: 'anxiety-worksheet', title: 'Work through an Anxiety Worksheet', detail: 'How you have been expressing yourself reads as anxious. Mapping the trigger and a coping plan can steady racing thoughts.', category: 'cbt', action: 'cbt:anxiety', priority: 1, why: 'fusion:facial_sentiment' })
  }
  if (sent === 'sadness') {
    push({ id: 'thought-reframing', title: 'Try Thought Reframing', detail: 'Your recent messages have felt low. Identifying cognitive distortions can help reframe heavy thoughts.', category: 'cbt', action: 'cbt:reframing', priority: 1, why: 'sentiment:sadness' })
  }
  if (sent === 'anger') {
    push({ id: 'stress-worksheet', title: 'Separate what you can control', detail: 'There has been some frustration in how you have been feeling. A stress worksheet helps you focus on what is in your control.', category: 'cbt', action: 'cbt:stress', priority: 2, why: 'sentiment:anger' })
  }

  if (habitSummary?.metrics) {
    for (const m of habitSummary.metrics) {
      if (m.loggedDays === 0) continue
      if (m.key === 'sleepHours' && m.adherence < 0.7) {
        push({ id: 'sleep-plan', title: 'Improve your sleep routine', detail: `You are averaging ${m.avg} ${m.unit} of sleep (target ${m.target}). A consistent wind-down routine can help.`, category: 'habit', action: 'habit:sleep', priority: 1, why: 'habit:sleep' })
      } else if (m.key === 'exerciseMinutes' && m.adherence < 0.6) {
        push({ id: 'activity-plan', title: 'Add some movement to your day', detail: `Exercise is averaging ${m.avg} ${m.unit} (target ${m.target}). Even a 10-minute walk lifts mood and reduces stress.`, category: 'habit', action: 'habit:exercise', priority: 2, why: 'habit:exercise' })
      } else if (m.key === 'screenTimeHours' && m.adherence < 0.6) {
        push({ id: 'screen-plan', title: 'Set a screen-time boundary', detail: `Screen time is averaging ${m.avg} ${m.unit} (target ${m.target} or less). A nightly cut-off protects your sleep and focus.`, category: 'habit', action: 'habit:screen', priority: 3, why: 'habit:screen' })
      } else if (m.key === 'meditationMinutes' && m.adherence < 0.5) {
        push({ id: 'meditation-habit', title: 'Build a short meditation habit', detail: 'A few minutes of guided breathing daily compounds into real calm.', category: 'meditation', action: 'meditation', priority: 3, why: 'habit:meditation' })
      }
    }
  }

  const topicKeys = Object.keys(topics)
  if (topicKeys.length) {
    const topTopic = topicKeys.sort((a, b) => topics[b] - topics[a])[0]
    push({ id: 'meditation-stress', title: 'Take a guided breathing break', detail: `Your journal keeps returning to ${topTopic}. A 5-minute breathing reset on the Meditation page can ease that pressure.`, category: 'meditation', action: 'meditation', priority: 2, why: `journal:${topTopic}` })
  }

  // Plan / habit adherence: simplify goals when struggling to keep up
  const paRatio = planAdherence?.ratio
  const paTotal = planAdherence?.total || 0
  const lowPlan = paRatio != null && paTotal > 0 && paRatio < 0.4
  const lowHabit = habitSummary?.adherence != null && (habitSummary.loggedDays || 0) > 0 && habitSummary.adherence < 0.4
  if (lowPlan || lowHabit) {
    push({ id: 'simplify-goals', title: 'Simplify today to one small win', detail: 'Your plan has felt hard to keep up with lately. Let us shrink it to a single, doable goal — steady momentum beats an overloaded checklist.', category: 'habit', action: 'simplify', priority: 2, why: 'adherence:low' })
  }

  // CBT completion -> reinforcing follow-up (shapes future guidance)
  if ((cbt || []).length) {
    const ctype = cbt[0]?.type
    push({ id: 'cbt-followup', title: 'Build on your last exercise', detail: 'You recently completed a CBT exercise — revisiting it helps the skill stick. Want to take the next step today?', category: 'cbt', action: ctype ? `cbt:${ctype}` : 'cbt:reframing', priority: 3, why: 'cbt:completion' })
  }

  if (!(cbt || []).length) {
    push({ id: 'start-cbt', title: 'Try your first CBT exercise', detail: 'CBT worksheets give you practical tools to handle tough thoughts. Pick one that fits how you feel today.', category: 'cbt', action: 'cbt:reframing', priority: 4, why: 'engagement:no_cbt' })
  }
  if (!(journals || []).length) {
    push({ id: 'start-journal', title: 'Write a journal reflection', detail: 'Putting feelings into words helps you spot patterns over time.', category: 'journal', action: 'journal', priority: 4, why: 'engagement:no_journal' })
  }

  if (persistentSadness(moodSummary)) {
    push({ id: 'talk-to-doctor-sadness', title: 'Repeated low mood — consider a check-in with a doctor', detail: 'Sadness has shown up across several weeks. Talking with a professional can help you understand what is underneath it and find a way forward.', category: 'clinical', action: 'doctor', priority: 1, why: 'mood:persistent_sadness' })
  }
  if (fusedRisk >= 0.6) {
    recs.unshift({ id: 'book-doctor', title: 'Consider talking to a professional', detail: 'Your recent signals suggest it may help to speak with a doctor. You can book a secure consultation through the Portal whenever you are ready.', category: 'clinical', action: 'doctor', priority: 1, why: 'risk:high' })
  }

  const best = {}
  for (const r of recs) {
    if (!(r.id in best) || r.priority < best[r.id].priority) best[r.id] = r
  }
  let ordered = Object.values(best).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))

  // Memory: drop non-clinical recs already seen recently, but keep clinical
  // escalations and never return an empty list.
  const prev = new Set(prevRecommendations || [])
  if (prev.size) {
    const fresh = ordered.filter((r) => r.category === 'clinical' || !prev.has(r.id))
    if (fresh.length) ordered = fresh
  }
  return ordered
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------
const CHECKIN = { id: 'evening-checkin', label: 'Evening Check-In with Rahat', type: 'checkin', action: 'chat' }
const JOURNAL = { id: 'journal-reflection', label: 'Journal Reflection', type: 'journal', action: 'journal' }
const MEDITATE = { id: 'meditation-5min', label: '5-Minute Meditation', type: 'meditation', action: 'meditation' }

const FOCUS_LIBRARY = {
  anxiety: { title: 'Managing Anxiety', tasks: [MEDITATE, { id: 'anxiety-worksheet', label: 'Anxiety Worksheet', type: 'cbt', action: 'cbt:anxiety' }, JOURNAL, CHECKIN] },
  placement_anxiety: { title: 'Placement Anxiety', tasks: [MEDITATE, { id: 'anxiety-worksheet', label: 'Anxiety Worksheet', type: 'cbt', action: 'cbt:anxiety' }, JOURNAL, CHECKIN] },
  low_mood: { title: 'Lifting Low Mood', tasks: [{ id: 'reframing-worksheet', label: 'Thought Reframing Worksheet', type: 'cbt', action: 'cbt:reframing' }, { id: 'gratitude-exercise', label: 'Gratitude Exercise', type: 'cbt', action: 'cbt:gratitude' }, JOURNAL, CHECKIN] },
  stress: { title: 'Reducing Stress', tasks: [MEDITATE, { id: 'stress-worksheet', label: 'Stress Worksheet', type: 'cbt', action: 'cbt:stress' }, JOURNAL, CHECKIN] },
  sleep: { title: 'Better Sleep', tasks: [{ id: 'sleep-habit', label: 'Log your sleep', type: 'habit', action: 'habit:sleep' }, MEDITATE, { id: 'screen-habit', label: 'Wind down — limit screen time', type: 'habit', action: 'habit:screen' }, CHECKIN] },
  balance: { title: 'Building Daily Balance', tasks: [MEDITATE, JOURNAL, { id: 'exercise-habit', label: 'Move your body for 30 min', type: 'habit', action: 'habit:exercise' }, CHECKIN] },
}

function pickFocus({ moodSummary, habitSummary, journals, riskScore }) {
  const emotion = dominantRecentEmotion(moodSummary)
  const emoRisk = Math.max(Number(riskScore) || 0, emotionalRisk(moodSummary))
  const topics = journalTopicCounts(journals)
  const placementWeight = [...PLACEMENT_TOPICS].reduce((s, t) => s + (topics[t] || 0), 0)

  if (emotion === 'Fear' && placementWeight > 0) return 'placement_anxiety'
  if (emotion === 'Fear') return 'anxiety'
  if (emotion === 'Sad' || emoRisk >= 0.6) return 'low_mood'
  if (habitSummary?.metrics) {
    const sleep = habitSummary.metrics.find((m) => m.key === 'sleepHours')
    if (sleep && sleep.loggedDays > 0 && sleep.adherence < 0.6) return 'sleep'
  }
  if (emotion === 'Angry' || placementWeight > 0) return 'stress'
  return 'balance'
}

export function generatePlan({ moodSummary, habitSummary, journals, cbt, riskScore = 0 } = {}) {
  const focus = pickFocus({ moodSummary, habitSummary, journals, riskScore })
  const spec = FOCUS_LIBRARY[focus]
  const emotion = dominantRecentEmotion(moodSummary)
  const emoRisk = Math.max(Number(riskScore) || 0, emotionalRisk(moodSummary))
  return {
    focus,
    title: spec.title,
    tasks: spec.tasks.map((t) => ({ ...t, done: false })),
    signals: {
      dominantEmotion: emotion,
      riskScore: Number(emoRisk.toFixed(4)),
      journalCount: (journals || []).length,
      cbtCount: (cbt || []).length,
      habitAdherence: habitSummary?.adherence || 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Firestore persistence
// ---------------------------------------------------------------------------
/** Live subscription to a patient's most recent active wellness plan. */
export function subscribeActivePlan(patientId, onChange, onError) {
  const q = query(collection(db, 'wellness_plans'), where('patientId', '==', patientId))
  return onSnapshot(
    q,
    (snap) => {
      const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      plans.sort((a, b) => (b.ts || 0) - (a.ts || 0))
      const active = plans.find((p) => p.active !== false) || plans[0] || null
      onChange(active)
    },
    (err) => {
      console.error('[wellness] plan subscription error', err)
      onError?.(err)
    },
  )
}

/** Generate a plan from the patient's signals and persist it as the active plan. */
export async function generateAndSavePlan(patientId, signals) {
  if (!patientId) throw new Error('Missing patient id')
  const plan = generatePlan(signals)
  const ref = await addDoc(collection(db, 'wellness_plans'), {
    patientId,
    focus: plan.focus,
    title: plan.title,
    tasks: plan.tasks,
    signals: plan.signals,
    active: true,
    progress: {},
    ts: Date.now(),
    generatedAt: serverTimestamp(),
  })
  return { id: ref.id, ...plan }
}

/** Toggle a plan task's completion for a given day (stored in `progress[date]`). */
export async function setTaskDone(planId, currentProgress, taskId, done, date = isoDate()) {
  const dayList = new Set(currentProgress?.[date] || [])
  if (done) dayList.add(taskId)
  else dayList.delete(taskId)
  const progress = { ...(currentProgress || {}), [date]: [...dayList] }
  await updateDoc(doc(db, 'wellness_plans', planId), { progress })
  return progress
}

/** Today's completion ratio for a plan { total, completed, ratio }. */
export function planAdherenceToday(plan, date = isoDate()) {
  if (!plan?.tasks?.length) return { total: 0, completed: 0, ratio: 0 }
  const done = new Set(plan.progress?.[date] || [])
  const valid = new Set(plan.tasks.map((t) => t.id))
  let completed = 0
  for (const id of done) if (valid.has(id)) completed += 1
  return { total: plan.tasks.length, completed, ratio: completed / plan.tasks.length }
}

/**
 * Count consecutive days (including today) on which the patient completed
 * every task in their active plan. Returns 0 when there are no completed days.
 */
export function planStreak(plan) {
  if (!plan?.tasks?.length || !plan?.progress) return 0
  const total = plan.tasks.length
  const today = isoDate()
  let streak = 0
  const cursor = new Date()
  // Walk backwards from today
  for (let i = 0; i <= 365; i++) {
    const d = isoDate(cursor)
    const done = (plan.progress[d] || []).length
    if (done >= total) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      // If today isn't done yet, keep going back from yesterday
      if (i === 0) { cursor.setDate(cursor.getDate() - 1); continue }
      break
    }
  }
  return streak
}

/**
 * Save a daily wellness-score snapshot to Firestore (one doc per patient per day).
 * Uses setDoc+merge so re-computing during the day is idempotent.
 */
export async function saveWellnessSnapshot(patientId, score) {
  if (!patientId || !score?.score) return
  const today = isoDate()
  const ref = doc(db, 'wellness_scores', `${patientId}_${today}`)
  await setDoc(
    ref,
    {
      patientId,
      date: today,
      score: score.score,
      level: score.level,
      components: score.components,
      ts: Date.now(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

/** Live subscription to a patient's wellness-score history (all stored snapshots). */
export function subscribeWellnessHistory(patientId, onChange, onError) {
  const q = query(collection(db, 'wellness_scores'), where('patientId', '==', patientId))
  return onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs
        .map((d) => d.data())
        .sort((a, b) => a.date.localeCompare(b.date))
      onChange(entries)
    },
    (err) => {
      console.error('[wellness] history error', err)
      onError?.(err)
    },
  )
}

/**
 * Persist today's recommendation set (one doc per patient per day) so the
 * engine can later suppress already-seen nudges and the doctor can see the
 * history of AI guidance. Idempotent within the day via setDoc+merge.
 */
export async function saveRecommendationsSnapshot(patientId, recommendations) {
  if (!patientId || !Array.isArray(recommendations) || !recommendations.length) return
  const today = isoDate()
  const ref = doc(db, 'recommendations', `${patientId}_${today}`)
  await setDoc(
    ref,
    {
      patientId,
      date: today,
      items: recommendations.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        action: r.action,
        why: r.why || '',
        priority: r.priority,
      })),
      ts: Date.now(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

/** Live subscription to a patient's recent recommendation snapshots (newest first). */
export function subscribeRecommendationHistory(patientId, onChange, onError) {
  const q = query(collection(db, 'recommendations'), where('patientId', '==', patientId))
  return onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs
        .map((d) => d.data())
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      onChange(entries)
    },
    (err) => {
      console.error('[wellness] recommendation history error', err)
      onError?.(err)
    },
  )
}

/**
 * Recommendation ids the patient has already seen in the last `days` days,
 * excluding today (so the just-saved snapshot can't suppress itself).
 */
export function prevRecommendationIds(history, days = 7, today = isoDate()) {
  const ids = []
  const seen = new Set()
  for (const snap of history || []) {
    if (!snap?.date || snap.date === today) continue
    for (const item of snap.items || []) {
      if (item?.id && !seen.has(item.id)) {
        seen.add(item.id)
        ids.push(item.id)
      }
    }
    if (ids.length > days * 6) break
  }
  return ids
}
