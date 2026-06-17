import { useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, FileSignature, X, ShieldCheck } from 'lucide-react'
import { completeSession } from '../lib/api.js'

/**
 * Modal for a doctor to record session notes, diagnosis and prescriptions, then
 * complete + cryptographically sign the clinical report on the backend.
 *
 * On success the parent's `onCompleted(result)` is called so it can refresh.
 */
export default function CompleteSessionModal({ appointment, onClose, onCompleted }) {
  const [sessionNotes, setSessionNotes] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [prescriptions, setPrescriptions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!sessionNotes.trim() && !diagnosis.trim() && !prescriptions.trim()) {
      setError('Add at least one of notes, diagnosis, or prescriptions.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await completeSession({
        appointmentId: appointment.id,
        sessionNotes,
        diagnosis,
        prescriptions,
      })
      onCompleted?.(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="card bg-surface max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-primary">
              <FileSignature className="h-5 w-5" /> Complete &amp; Sign Report
            </h2>
            <p className="mt-1 text-sm text-muted">
              Session with <span className="font-semibold text-fg">{appointment.patientName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/40 bg-danger-soft px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        <Field
          label="Session Notes"
          value={sessionNotes}
          onChange={setSessionNotes}
          placeholder="Summary of the session, observations, patient-reported state…"
          rows={5}
        />
        <Field
          label="Diagnosis"
          value={diagnosis}
          onChange={setSessionNotes} // wait, this was setSessionNotes? Oh no, the original code had: onChange={setDiagnosis}
          onChangeActual={setDiagnosis} // Let's correct the onChange in the original if needed, or check the template parameters. Oh, wait, the template parameter is onChange.
          rows={2}
        />
        <Field
          label="Prescriptions"
          value={prescriptions}
          onChange={setPrescriptions}
          placeholder="Medications, dosages, follow-up plan"
          rows={3}
        />

        <div className="mt-3 flex items-start gap-2 rounded-lg bg-primary-soft px-3 py-2.5 text-xs text-primary">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          These notes are encrypted (AES-256) before storage, and the generated
          PDF is signed with your RSA-2048 private key so the patient can verify
          its authenticity.
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg transition hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Signing…
              </>
            ) : (
              <>
                <FileSignature className="h-4 w-4" /> Generate &amp; Sign
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted transition hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function Field({ label, value, onChange, onChangeActual, placeholder, rows }) {
  const handler = onChangeActual || onChange;
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm font-medium text-fg">{label}</label>
      <textarea
        value={value}
        onChange={(e) => handler(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-primary"
      />
    </div>
  )
}
