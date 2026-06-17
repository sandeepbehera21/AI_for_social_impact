import { useState } from 'react'
import { motion } from 'framer-motion'
import { Star, X, Send, Loader2, CheckCircle2 } from 'lucide-react'
import { submitRating } from '../lib/ratings.js'

/**
 * Modal for a patient to leave a star rating + optional comment for a doctor
 * after a completed session.
 *
 * Props:
 *   appointment  — { id, doctorId, doctorName, patientId, patientName }
 *   onClose      — called when the modal should be dismissed
 *   onSubmitted  — called after successful submission with the rating value
 */
export default function RateDoctorModal({ appointment, onClose, onSubmitted }) {
  const [stars, setStars] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const displayStars = hovered || stars

  const handleSubmit = async () => {
    if (stars === 0) { setError('Please select a star rating.'); return }
    setBusy(true)
    setError('')
    try {
      await submitRating({
        doctorId:      appointment.doctorId,
        patientId:     appointment.patientId,
        patientName:   appointment.patientName || 'Patient',
        rating:        stars,
        comment,
        appointmentId: appointment.id,
      })
      setDone(true)
      setTimeout(() => { onSubmitted?.(stars); onClose?.() }, 1800)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const labels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="card bg-surface w-full max-w-md overflow-hidden"
      >
        {done ? (
          /* ── Success state ── */
          <div className="flex flex-col items-center gap-4 px-8 py-12 text-center">
            <CheckCircle2 className="h-16 w-16 text-emerald-400" />
            <h2 className="text-xl font-bold text-fg">Thank You!</h2>
            <p className="text-muted">
              Your {stars}-star rating for{' '}
              <span className="font-semibold text-fg">
                Dr. {appointment.doctorName}
              </span>{' '}
              has been saved.
            </p>
          </div>
        ) : (
          <>
            {/* ── Header ── */}
            <div className="flex items-start justify-between border-b border-border px-6 py-5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
                  <Star className="h-5 w-5 text-amber-400" />
                  Rate Your Session
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  with Dr. {appointment.doctorName}
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* ── Star picker ── */}
            <div className="px-6 py-6">
              <p className="mb-4 text-sm text-muted">
                How was your experience? Your feedback helps other patients choose
                the right doctor.
              </p>

              {/* Interactive stars */}
              <div className="mb-2 flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStars(s)}
                    onMouseEnter={() => setHovered(s)}
                    onMouseLeave={() => setHovered(0)}
                    className="transition-transform hover:scale-125 focus:outline-none"
                    aria-label={`${s} star${s > 1 ? 's' : ''}`}
                  >
                    <svg viewBox="0 0 20 20" className="h-10 w-10">
                      <path
                        d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                        fill={displayStars >= s ? '#FBBF24' : 'var(--border-strong)'}
                        className="transition-colors duration-100"
                      />
                    </svg>
                  </button>
                ))}
              </div>

              {/* Label */}
              <div className="mb-6 h-6 text-center">
                {displayStars > 0 && (
                  <motion.span
                    key={displayStars}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm font-semibold text-amber-500"
                  >
                    {labels[displayStars]}
                  </motion.span>
                )}
              </div>

              {/* Comment */}
              <label className="mb-1.5 block text-sm font-medium text-fg">
                Comment <span className="text-faint">(optional)</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share details about your experience…"
                rows={3}
                maxLength={500}
                className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none transition focus:border-accent placeholder:text-faint"
              />
              <div className="mt-1 text-right text-xs text-faint">
                {comment.length}/500
              </div>

              {/* Error */}
              {error && (
                <div className="mt-3 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="mt-5 flex gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={busy || stars === 0}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-fg transition hover:bg-accent/90 disabled:opacity-40"
                >
                  {busy ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
                  ) : (
                    <><Send className="h-4 w-4" /> Submit Rating</>
                  )}
                </button>
                <button
                  onClick={onClose}
                  disabled={busy}
                  className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}
