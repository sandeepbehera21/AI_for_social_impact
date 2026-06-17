/**
 * Derive contextual action buttons from a chat payload.
 *
 * Buttons are driven primarily by the backend's detected intent /
 * conversation_state, with a light text fallback so empathetic replies that
 * *recommend* the Meditation page (without a pure "meditation" intent) still
 * surface the button.
 *
 * Each action: { key, label, to }  — `to` is a react-router path.
 * Crisis (safety_trigger) actions are handled separately by the crisis panel.
 *
 * Routes used (verified to exist in App.jsx):
 *   /meditation            → MeditationPage
 *   /login                 → SignInPage (doctor/patient entry)
 *   /#privacy              → HomePage "Radically Private" section anchor
 */
export function deriveActions(payload) {
  if (!payload || payload.type === 'safety_trigger') return []

  const a = payload.analysis || {}
  const intent = a.dominant_intent || ''
  const state = a.conversation_state || ''
  const text = payload.response || ''
  const actions = []
  const seen = new Set()
  const add = (key, label, to) => {
    if (seen.has(key)) return
    seen.add(key)
    actions.push({ key, label, to })
  }

  // Meditation — intent, state, or an explicit recommendation in the text.
  if (
    intent === 'meditation' ||
    state === 'meditation_guidance' ||
    /meditation page|breathing (?:timer|exercise)/i.test(text)
  ) {
    add('meditation', 'Start Meditation', '/meditation')
  }

  // Doctor consultation — booking/appointment intent, state, Portal mention, or
  // an explicit early-escalation flag from the backend (fused text+face risk).
  if (
    intent === 'doctor_booking' ||
    intent === 'appointment_scheduling' ||
    state === 'doctor_booking' ||
    payload.show_doctor_booking === true ||
    /\bPortal\b|consult\b|doctor\b/i.test(text)
  ) {
    add('doctor', 'Consult Doctor', '/consult-doc')
  }

  // Journaling — mentions in text.
  if (
    /journal|diary|reflect|log your thoughts|write down/i.test(text)
  ) {
    add('journal', 'Open Journal', '/journal')
  }

  // CBT worksheets — mentions in text.
  if (
    /cbt|worksheet|cognitive|reframing/i.test(text)
  ) {
    add('cbt', 'Open CBT Worksheet', '/cbt')
  }

  // Habits tracking — mentions in text.
  if (
    /habit|track|sleep hours|screen time|exercise/i.test(text)
  ) {
    add('habits', 'Log Habits', '/habits')
  }

  // SOS support — mentions in text.
  if (
    /sos|crisis|emergency|suicide|helpline|immediate support/i.test(text)
  ) {
    add('sos', 'Immediate SOS Support', '/sos')
  }

  // Privacy / face tracking.
  if (intent === 'privacy' || intent === 'face_tracking') {
    add('privacy', 'Learn About Privacy', '/#privacy')
  }

  return actions
}
