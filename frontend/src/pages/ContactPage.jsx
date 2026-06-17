import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mail,
  User,
  MessageSquare,
  PenTool,
  Loader2,
  CheckCircle,
  HelpCircle,
  Siren,
  Clock,
} from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'

export default function ContactPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  // Form states
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errors, setErrors] = useState({})

  const validate = () => {
    const newErrors = {}
    if (!name.trim()) newErrors.name = 'Please enter your name.'
    if (!email.trim()) {
      newErrors.email = 'Please enter your email address.'
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Please enter a valid email address.'
    }
    if (!subject.trim()) newErrors.subject = 'Please specify a subject.'
    if (!message.trim()) {
      newErrors.message = 'Please write a message.'
    } else if (message.trim().length < 10) {
      newErrors.message = 'Your message must be at least 10 characters long.'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    setBusy(true)
    // Mock API call
    setTimeout(() => {
      setBusy(false)
      setSuccess(true)
      setName('')
      setEmail('')
      setSubject('')
      setMessage('')
    }, 1200)
  }

  return (
    <PageTransition className="mx-auto max-w-5xl px-5 py-12">
      <div className="grid gap-10 md:grid-cols-12">
        {/* Info Column */}
        <div className="flex flex-col gap-6 md:col-span-5">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-fg">Contact MindEase</h1>
            <p className="mt-3 text-sm text-muted leading-relaxed">
              Have questions about local AI processing, clinical consent records, or encryption
              keys? We're here to help you navigate our secure features.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="card flex items-start gap-4 p-5">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Clock className="h-4.5 w-4.5" />
              </div>
              <div>
                <h4 className="font-bold text-fg text-sm">Response Time</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  We usually respond to technical and cryptographic support inquiries within 24–48 hours.
                </p>
              </div>
            </div>

            <div className="card flex items-start gap-4 p-5 border-danger/20 bg-danger-soft/10 text-danger">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-danger shadow-sm">
                <Siren className="h-4.5 w-4.5" />
              </div>
              <div>
                <h4 className="font-bold text-fg text-sm">Emergency Support</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  If you are experiencing a mental health emergency, please do not use this form.
                  Call <strong className="text-fg">911</strong> or the <strong className="text-fg">988 Lifeline</strong> immediately.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Form Column */}
        <div className="md:col-span-7">
          <AnimatePresence mode="wait">
            {success ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="card flex flex-col items-center p-8 text-center shadow-md md:p-12"
              >
                <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success">
                  <CheckCircle className="h-8 w-8" />
                </div>
                <h2 className="text-xl font-bold text-fg">Message Received Securely</h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Thank you for reaching out to us. We have received your query and our team
                  will get back to you shortly.
                </p>
                <button
                  onClick={() => setSuccess(false)}
                  className="mt-6 rounded-full bg-primary px-6 py-2.5 font-semibold text-primary-fg shadow-sm transition hover:bg-primary-hover"
                >
                  Send another message
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="card p-6 shadow-sm md:p-8"
              >
                <h2 className="mb-6 text-xl font-bold text-fg">Send us a message</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Name field */}
                  <div>
                    <label htmlFor="name-input" className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                      Full Name
                    </label>
                    <div
                      className={`flex items-center gap-2 rounded-lg border px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${
                        errors.name ? 'border-danger' : 'border-border bg-surface-2'
                      }`}
                    >
                      <User className="h-4 w-4 shrink-0 text-faint" />
                      <input
                        id="name-input"
                        type="text"
                        placeholder="John Doe"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value)
                          if (errors.name) setErrors((prev) => ({ ...prev, name: null }))
                        }}
                        aria-invalid={!!errors.name}
                        aria-describedby={errors.name ? 'name-error' : undefined}
                        className="w-full bg-transparent py-3 text-sm text-fg outline-none placeholder:text-faint"
                      />
                    </div>
                    {errors.name && (
                      <span id="name-error" className="mt-1 block text-xs text-danger">
                        {errors.name}
                      </span>
                    )}
                  </div>

                  {/* Email field */}
                  <div>
                    <label htmlFor="email-input" className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                      Email Address
                    </label>
                    <div
                      className={`flex items-center gap-2 rounded-lg border px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${
                        errors.email ? 'border-danger' : 'border-border bg-surface-2'
                      }`}
                    >
                      <Mail className="h-4 w-4 shrink-0 text-faint" />
                      <input
                        id="email-input"
                        type="email"
                        placeholder="john@example.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          if (errors.email) setErrors((prev) => ({ ...prev, email: null }))
                        }}
                        aria-invalid={!!errors.email}
                        aria-describedby={errors.email ? 'email-error' : undefined}
                        className="w-full bg-transparent py-3 text-sm text-fg outline-none placeholder:text-faint"
                      />
                    </div>
                    {errors.email && (
                      <span id="email-error" className="mt-1 block text-xs text-danger">
                        {errors.email}
                      </span>
                    )}
                  </div>

                  {/* Subject field */}
                  <div>
                    <label htmlFor="subject-input" className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                      Subject
                    </label>
                    <div
                      className={`flex items-center gap-2 rounded-lg border px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${
                        errors.subject ? 'border-danger' : 'border-border bg-surface-2'
                      }`}
                    >
                      <PenTool className="h-4 w-4 shrink-0 text-faint" />
                      <input
                        id="subject-input"
                        type="text"
                        placeholder="E.g. Encryption keys query"
                        value={subject}
                        onChange={(e) => {
                          setSubject(e.target.value)
                          if (errors.subject) setErrors((prev) => ({ ...prev, subject: null }))
                        }}
                        aria-invalid={!!errors.subject}
                        aria-describedby={errors.subject ? 'subject-error' : undefined}
                        className="w-full bg-transparent py-3 text-sm text-fg outline-none placeholder:text-faint"
                      />
                    </div>
                    {errors.subject && (
                      <span id="subject-error" className="mt-1 block text-xs text-danger">
                        {errors.subject}
                      </span>
                    )}
                  </div>

                  {/* Message field */}
                  <div>
                    <label htmlFor="message-input" className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                      Your Message
                    </label>
                    <div
                      className={`flex items-start gap-2 rounded-lg border px-3 py-1.5 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${
                        errors.message ? 'border-danger' : 'border-border bg-surface-2'
                      }`}
                    >
                      <MessageSquare className="mt-2.5 h-4 w-4 shrink-0 text-faint" />
                      <textarea
                        id="message-input"
                        rows="4"
                        placeholder="How can we assist you?"
                        value={message}
                        onChange={(e) => {
                          setMessage(e.target.value)
                          if (errors.message) setErrors((prev) => ({ ...prev, message: null }))
                        }}
                        aria-invalid={!!errors.message}
                        aria-describedby={errors.message ? 'message-error' : undefined}
                        className="w-full bg-transparent py-2 text-sm text-fg outline-none placeholder:text-faint resize-y min-h-[100px]"
                      />
                    </div>
                    {errors.message && (
                      <span id="message-error" className="mt-1 block text-xs text-danger">
                        {errors.message}
                      </span>
                    )}
                  </div>

                  {/* Submit button */}
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-60"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {busy ? 'Submitting secure ticket…' : 'Send Message'}
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageTransition>
  )
}
