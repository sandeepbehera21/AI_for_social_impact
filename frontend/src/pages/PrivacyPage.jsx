import React from 'react'
import PageTransition from '../components/PageTransition.jsx'
import { Shield, Lock, Eye } from 'lucide-react'

export default function PrivacyPage() {
  return (
    <PageTransition className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="card p-8 sm:p-12 border border-border bg-surface shadow-xl relative overflow-hidden">
        {/* Decorative background shapes */}
        <div className="absolute -top-16 -right-16 h-36 w-36 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 h-36 w-36 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 mb-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Shield className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold text-fg">Privacy Policy</h1>
            <p className="text-xs text-muted mt-1">Last Updated: June 14, 2026</p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted mb-8 border-b border-border pb-6">
          At MindEase, your privacy is our core commitment. We design our platforms so that your clinical discussions, notes, and emotional biometric indicators remain strictly under your control. Below is a detailed explanation of what data we process, how we secure it, and your rights.
        </p>

        <div className="space-y-8 text-sm text-fg leading-relaxed">
          <section>
            <h2 className="text-lg font-bold text-accent mb-3 flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary" /> 1. Confidentiality & Encryption
            </h2>
            <p className="text-muted">
              All clinical transcripts, worksheets, and consultation notes are encrypted in transit using TLS 1.3 and at rest using 256-bit Advanced Encryption Standard (AES-256). For telehealth consultations, your private keys live exclusively in secure storage and are never stored unencrypted on our backend database.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-accent mb-3 flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" /> 2. Personal Data We Collect
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-muted">
              <li><strong>Account Credentials:</strong> Basic registry information (Name, Email, password) is stored securely via Firebase Auth.</li>
              <li><strong>Self-Reflection Data:</strong> Journals and CBT worksheet content you choose to log are stored privately under your profile.</li>
              <li><strong>Facial Biometrics:</strong> When the camera is active, local emotion recognition takes place. If you are signed in, we periodically save aggregated emotion trends to customize your care dashboard. We NEVER store raw webcam videos or photos on our servers.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-accent mb-3">3. How We Use Your Data</h2>
            <p className="text-muted">
              Your wellness signals are exclusively used to power the smart recommendations engine (e.g. suggesting breathing exercises when anxiety triggers are detected) and to give your clinician pre-consultation insights if you choose to book a video session. We do NOT sell, license, or share your healthcare data with advertisers or third parties.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-accent mb-3">4. Your Rights and Deletion</h2>
            <p className="text-muted">
              You retain the absolute right to download, inspect, or delete your entire MindEase account and its corresponding journals, CBT metrics, and mood records. Simply head to your dashboard settings or request assistance at <a href="mailto:privacy@mindease.app" className="text-primary hover:underline font-semibold">privacy@mindease.app</a>.
            </p>
          </section>
        </div>
      </div>
    </PageTransition>
  )
}
