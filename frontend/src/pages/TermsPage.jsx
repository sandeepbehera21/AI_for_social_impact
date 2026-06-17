import React from 'react'
import PageTransition from '../components/PageTransition.jsx'
import { FileText, HeartHandshake, AlertTriangle } from 'lucide-react'

export default function TermsPage() {
  return (
    <PageTransition className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="card p-8 sm:p-12 border border-border bg-surface shadow-xl relative overflow-hidden">
        {/* Decorative background shapes */}
        <div className="absolute -top-16 -left-16 h-36 w-36 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-16 h-36 w-36 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 mb-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <FileText className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold text-fg">Terms of Service</h1>
            <p className="text-xs text-muted mt-1">Last Updated: June 14, 2026</p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted mb-8 border-b border-border pb-6">
          Welcome to MindEase. By accessing our companion chatbot Rahat, using our cognitive tools, or scheduling a video consultation, you agree to comply with the following Terms of Service.
        </p>

        <div className="space-y-8 text-sm text-fg leading-relaxed">
          <section className="bg-warning-soft/20 border border-warning/20 p-5 rounded-2xl">
            <h2 className="text-sm font-bold text-warning mb-2 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Medical Disclaimer (Crucial)
            </h2>
            <p className="text-xs text-muted leading-relaxed">
              MindEase and its AI companion Rahat do NOT provide clinical medical diagnoses or crisis intervention. If you are experiencing thoughts of self-harm, a severe psychiatric emergency, or any critical life-safety distress, please call emergency services (e.g. 911 or 988) immediately. AI responses are strictly supportive, reflective, and intended for general wellness guidance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-accent mb-3 flex items-center gap-2">
              <HeartHandshake className="h-4 w-4 text-primary" /> 1. Acceptable Use
            </h2>
            <p className="text-muted">
              You agree to use MindEase solely for healthy personal reflection, CBT worksheets, and telehealth scheduling. Any attempts to inject malicious scripts (XSS), bypass object-level authorization (BOLA) rules, scrape data, or overload our API endpoint targets will result in immediate termination of account access and potential legal referral.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-accent mb-3">2. Clinician Registration & Credentials</h2>
            <p className="text-muted">
              Users registering under the clinician/doctor portal must provide accurate medical licensing credentials. Accounts remain unverified and blocked from patient data access until credentials are confirmed by an administrator. Self-verification attempts are flagged automatically.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-accent mb-3">3. Telehealth Consultations</h2>
            <p className="text-muted">
              Consultations scheduled on MindEase are structured between individual patients and licensed therapists. MindEase provides the encrypted WebRTC/Agora channel and key orchestration but is not responsible for the clinical decisions or malpractice of third-party therapists.
            </p>
          </section>
        </div>
      </div>
    </PageTransition>
  )
}
