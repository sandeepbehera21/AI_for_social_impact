import React from 'react'
import PageTransition from '../components/PageTransition.jsx'
import { Info, HelpCircle } from 'lucide-react'

export default function CookiesPage() {
  return (
    <PageTransition className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="card p-8 sm:p-12 border border-border bg-surface shadow-xl relative overflow-hidden">
        {/* Decorative background shapes */}
        <div className="absolute -top-16 -right-16 h-36 w-36 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 h-36 w-36 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 mb-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Info className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold text-fg">Cookie Policy</h1>
            <p className="text-xs text-muted mt-1">Last Updated: June 14, 2026</p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted mb-8 border-b border-border pb-6">
          MindEase uses essential cookies and browser storage technologies to provide a secure and functional chatbot, portal, and authentication experience.
        </p>

        <div className="space-y-8 text-sm text-fg leading-relaxed">
          <section>
            <h2 className="text-lg font-bold text-accent mb-3 flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-primary" /> What are Cookies & Local Storage?
            </h2>
            <p className="text-muted">
              Cookies are tiny text files stored on your computer when you load websites. Local storage (localStorage) and session storage (sessionStorage) are standard web browser storage features used to remember user options, active sessions, and local application states offline.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-accent mb-3">1. Essential Cookies & Identifiers</h2>
            <p className="text-muted">
              We only place cookies that are strictly necessary to deliver safety and functionality:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-2 text-muted">
              <li><strong>Session Authentication:</strong> Firebase Auth relies on local browser states to confirm your signed-in identity securely when navigating across patient dashboards.</li>
              <li><strong>Chat Memory Token:</strong> `sessionStorage` holds a temporary, non-identifying `mindease_session_id` so that our companion Rahat can track topics across consecutive turns. This token is wiped automatically when you close the tab or log out.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-accent mb-3">2. Performance & Cache Storage</h2>
            <p className="text-muted">
              To avoid consuming 35MB of bandwidth every time you use our local emotion tracking dashboard, we cache the offline ONNX model file inside your browser's CacheStorage API. This speeds up local loading times dramatically and does not collect any data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-accent mb-3">3. No Advertising Cookies</h2>
            <p className="text-muted">
              We do NOT implement advertising or marketing tracking scripts (e.g. Meta pixel, Google Ads) on our authenticated dashboard pages. Your digital mental health footprint is completely private.
            </p>
          </section>
        </div>
      </div>
    </PageTransition>
  )
}
