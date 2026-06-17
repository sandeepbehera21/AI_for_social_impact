import JSZip from 'jszip'
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore'
import { db } from './firebase.js'

/**
 * Fetch all data for the patient and compile it into a ZIP download.
 */
export async function exportPatientData(profile) {
  if (!profile?.uid) {
    throw new Error('User profile is not loaded.')
  }

  const uid = profile.uid
  
  // 1. Fetch all collections in parallel
  const [
    userSnap,
    journalsSnap,
    cbtSnap,
    moodSnap,
    habitsSnap,
    scoresSnap,
    plansSnap
  ] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDocs(query(collection(db, 'journals'), where('patientId', '==', uid))),
    getDocs(query(collection(db, 'cbt_exercises'), where('patientId', '==', uid))),
    getDocs(query(collection(db, 'mood_entries'), where('patientId', '==', uid))),
    getDocs(query(collection(db, 'habit_entries'), where('patientId', '==', uid))),
    getDocs(query(collection(db, 'wellness_scores'), where('patientId', '==', uid))),
    getDocs(query(collection(db, 'wellness_plans'), where('patientId', '==', uid)))
  ])

  const zip = new JSZip()

  // 2. Profile Metadata
  const userProfile = userSnap.exists() ? userSnap.data() : {}
  zip.file('profile.json', JSON.stringify({
    uid,
    name: userProfile.name || '',
    email: userProfile.email || '',
    role: userProfile.role || '',
    registrationDate: userProfile.registrationDate?.toDate?.()?.toISOString() || userProfile.registrationDate || '',
    sharingConsent: userProfile.sharing || { journal: false, habits: false, mood: false, cbt: false }
  }, null, 2))

  // 3. Journals (Plaintext)
  let journalsText = 'MINDEASE JOURNAL EXPORT\n=======================\n\n'
  const journals = journalsSnap.docs.map(d => d.data())
  // Sort journals by timestamp desc
  journals.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  
  if (journals.length === 0) {
    journalsText += 'No journal entries found.\n'
  } else {
    journals.forEach((j, index) => {
      const dateStr = j.ts ? new Date(j.ts).toLocaleString() : '—'
      journalsText += `Entry #${index + 1}\n`
      journalsText += `Date: ${dateStr}\n`
      journalsText += `Title: ${j.title || 'Untitled'}\n`
      journalsText += `Emotion Tag: ${j.emotion || 'None'}\n`
      journalsText += `Stress Topic: ${j.topic || 'None'}\n`
      journalsText += `--------------------------------------------------\n`
      journalsText += `${j.content || ''}\n`
      journalsText += `==================================================\n\n`
    })
  }
  zip.file('journals.txt', journalsText)

  // 4. CBT Exercises (JSON)
  const cbtWorksheets = cbtSnap.docs.map(d => ({
    id: d.id,
    type: d.data().type,
    timestamp: d.data().ts ? new Date(d.data().ts).toISOString() : '',
    data: d.data().data || {}
  }))
  zip.file('cbt_worksheets.json', JSON.stringify(cbtWorksheets, null, 2))

  // 5. Mood History (CSV)
  let moodCsv = 'Timestamp,Date,DominantEmotion,Confidence\n'
  const moodEntries = moodSnap.docs.map(d => d.data())
  moodEntries.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  moodEntries.forEach(m => {
    const timeStr = m.ts ? new Date(m.ts).toISOString() : ''
    const dateStr = m.ts ? new Date(m.ts).toLocaleDateString('sv-SE') : ''
    moodCsv += `${m.ts || ''},"${timeStr}","${m.dominantEmotion || m.dominant || ''}",${m.confidence || 0}\n`
  })
  zip.file('mood_history.csv', moodCsv)

  // 6. Wellness Scores (CSV)
  let scoresCsv = 'Timestamp,Date,Score,Level\n'
  const scoreEntries = scoresSnap.docs.map(d => d.data())
  scoreEntries.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  scoreEntries.forEach(s => {
    const timeStr = s.ts ? new Date(s.ts).toISOString() : ''
    scoresCsv += `${s.ts || ''},"${s.date || ''}",${s.score || 0},"${s.level || ''}"\n`
  })
  zip.file('wellness_scores.csv', scoresCsv)

  // 7. Habits (CSV)
  let habitsCsv = 'Date,SleepHours,ExerciseMinutes,WaterGlasses,MeditationMinutes,ScreenTimeHours,Timestamp\n'
  const habitEntries = habitsSnap.docs.map(d => d.data())
  habitEntries.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  habitEntries.forEach(h => {
    habitsCsv += `"${h.date || ''}",${h.sleepHours || 0},${h.exerciseMinutes || 0},${h.waterGlasses || 0},${h.meditationMinutes || 0},${h.screenTimeHours || 0},${h.ts || ''}\n`
  })
  zip.file('habits.csv', habitsCsv)

  // 8. Wellness Plans (JSON)
  const plans = plansSnap.docs.map(d => ({
    id: d.id,
    title: d.data().title,
    active: d.data().active ?? true,
    createdAt: d.data().ts ? new Date(d.data().ts).toISOString() : '',
    tasks: d.data().tasks || [],
    progress: d.data().progress || {}
  }))
  zip.file('wellness_plans.json', JSON.stringify(plans, null, 2))

  // 9. Generate and Trigger Download
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(zipBlob)
  const link = document.createElement('a')
  link.href = url
  link.download = `mindease_my_data_${new Date().toLocaleDateString('sv-SE')}.zip`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
