import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  addDoc
} from 'firebase/firestore'
import { db } from './firebase.js'
import { isoDate } from './habits.js'

/**
 * Subscribes to real-time notifications for a specific user (patient or doctor).
 * Results are sorted by `ts` (timestamp) descending.
 */
export function subscribeNotifications(userId, onChange, onError) {
  if (!userId) return () => {}
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId)
  )
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Sort in-memory to avoid needing a composite index for basic queries
      list.sort((a, b) => (b.ts || 0) - (a.ts || 0))
      onChange(list)
    },
    (err) => {
      console.error('[notifications] subscription error', err)
      onError?.(err)
    }
  )
}

/**
 * Mark a notification as read.
 */
export async function markAsRead(notificationId) {
  if (!notificationId) return
  await updateDoc(doc(db, 'notifications', notificationId), {
    read: true,
    readAt: Date.now(),
  })
}

/**
 * Delete a notification document.
 */
export async function deleteNotification(notificationId) {
  if (!notificationId) return
  await deleteDoc(doc(db, 'notifications', notificationId))
}

/**
 * Evaluates the patient's current signals and existing notifications list,
 * then generates any missing reminder notifications (idempotent per day/event).
 */
export async function checkAndGenerateNotifications(userId, signals, existingNotifications = []) {
  if (!userId || !signals) return

  const today = isoDate()
  const now = Date.now()

  // Helper to check if a notification of a specific type/date or type/appointment already exists
  const hasNotif = (type, dateOrKey = '') => {
    return existingNotifications.some(n => {
      if (n.type !== type) return false
      if (dateOrKey) {
        return n.date === dateOrKey || n.appointmentId === dateOrKey || n.key === dateOrKey
      }
      return true
    })
  }

  // 1. Habit reminders: if patient has habits and hasn't logged today
  const hasHabits = signals.habitSummary && signals.habitSummary.loggedDays !== undefined
  const habitsDoneToday = signals.habitSummary?.metrics?.some(m => m.loggedDays > 0) // rough proxy
  if (hasHabits && !habitsDoneToday && !hasNotif('habit_reminder', today)) {
    const notifId = `${userId}_habit_reminder_${today}`
    await setDoc(doc(db, 'notifications', notifId), {
      userId,
      type: 'habit_reminder',
      title: 'Habit Reminder',
      detail: "Don't forget to track your habits today to maintain your streak!",
      read: false,
      ts: now,
      date: today,
      key: today,
      createdAt: serverTimestamp(),
    })
  }

  // 2. Wellness check-ins: if patient has not updated mood or wellness score today
  const moodDoneToday = signals.moodSummary && signals.moodSummary.latest && (now - (signals.moodSummary.latest.ts || 0) < 16 * 60 * 60 * 1000)
  if (!moodDoneToday && !hasNotif('wellness_checkin', today)) {
    const notifId = `${userId}_wellness_checkin_${today}`
    await setDoc(doc(db, 'notifications', notifId), {
      userId,
      type: 'wellness_checkin',
      title: 'Wellness Check-in',
      detail: "It's time for your daily wellness check-in. Tell Rahat how you feel!",
      read: false,
      ts: now,
      date: today,
      key: today,
      createdAt: serverTimestamp(),
    })
  }

  // 3. Appointment reminders: if there's an approved appointment scheduled for today or tomorrow
  if (Array.isArray(signals.appointments)) {
    const ONE_DAY = 24 * 60 * 60 * 1000
    for (const appt of signals.appointments) {
      if (appt.status === 'approved' || appt.status === 'active') {
        const apptTs = appt.dateTime ? new Date(appt.dateTime).getTime() : 0
        const isSoon = apptTs && (apptTs - now > 0) && (apptTs - now < 2 * ONE_DAY)
        if (isSoon && !hasNotif('appointment_reminder', appt.id)) {
          const notifId = `${userId}_appt_${appt.id}`
          const formattedTime = new Date(appt.dateTime).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
          await setDoc(doc(db, 'notifications', notifId), {
            userId,
            type: 'appointment_reminder',
            title: 'Upcoming Appointment',
            detail: `You have a session with Dr. ${appt.doctorName} on ${formattedTime}.`,
            read: false,
            ts: now,
            appointmentId: appt.id,
            createdAt: serverTimestamp(),
          })
        }
      }
    }
  }

  // 4. Journal nudges: if no journal logged in last 48 hours
  const lastJournalTs = Array.isArray(signals.journals) && signals.journals[0]?.ts
  const noJournalRecently = !lastJournalTs || (now - lastJournalTs > 48 * 60 * 60 * 1000)
  if (noJournalRecently && !hasNotif('journal_nudge', today)) {
    const notifId = `${userId}_journal_nudge_${today}`
    await setDoc(doc(db, 'notifications', notifId), {
      userId,
      type: 'journal_nudge',
      title: 'Journal Reflection',
      detail: 'Take a few minutes to write down your thoughts. Journaling helps spot patterns.',
      read: false,
      ts: now,
      date: today,
      key: today,
      createdAt: serverTimestamp(),
    })
  }

  // 5. CBT reminders: if they have a recommended cbt worksheet and haven't completed it
  if (Array.isArray(signals.recommendations)) {
    const cbtRec = signals.recommendations.find(r => r.category === 'cbt')
    if (cbtRec && !hasNotif('cbt_reminder', cbtRec.id)) {
      const notifId = `${userId}_cbt_${cbtRec.id}`
      await setDoc(doc(db, 'notifications', notifId), {
        userId,
        type: 'cbt_reminder',
        title: 'Recommended CBT Exercise',
        detail: `Based on your recent check-ins, we recommend: ${cbtRec.title}.`,
        read: false,
        ts: now,
        key: cbtRec.id,
        createdAt: serverTimestamp(),
      })
    }
  }

  // 6. SOS follow-ups: if they triggered any crisis event in the last 24 hours
  if (Array.isArray(signals.crisisEvents)) {
    const recentCrisis = signals.crisisEvents.find(e => now - (e.ts || 0) < 24 * 60 * 60 * 1000)
    if (recentCrisis && !hasNotif('sos_followup', today)) {
      const notifId = `${userId}_sos_followup_${today}`
      await setDoc(doc(db, 'notifications', notifId), {
        userId,
        type: 'sos_followup',
        title: 'MindEase Care Check',
        detail: 'We noticed you used a calming tool recently. How are you feeling now? We are here to support you.',
        read: false,
        ts: now,
        date: today,
        key: today,
        createdAt: serverTimestamp(),
      })
    }
  }
}
