import { Brain } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-surface/60">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Brain className="h-4 w-4" />
            </span>
            <span className="brand-text text-base font-extrabold tracking-tight">MindEase</span>
          </div>
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted sm:justify-start">
            <Link to="/about" className="transition-colors hover:text-primary">About</Link>
            <Link to="/contact" className="transition-colors hover:text-primary">Contact</Link>
            <Link to="/privacy" className="transition-colors hover:text-primary">Privacy Policy</Link>
            <Link to="/terms" className="transition-colors hover:text-primary">Terms of Service</Link>
            <Link to="/cookies" className="transition-colors hover:text-primary">Cookie Policy</Link>
          </nav>
        </div>
        <p className="mt-5 text-center text-xs text-faint sm:text-left border-t border-border/40 pt-4 leading-relaxed">
          © 2026 MindEase. All rights reserved. <br className="hidden sm:inline" />
          <span className="font-semibold text-muted">AI Support Notice:</span> MindEase and its virtual companion Rahat provide general supportive guidance and educational tools. Rahat is not a medical professional, psychiatrist, or crisis intervention service. If you are experiencing a mental health crisis or require clinical assistance, please contact emergency services (such as 911 or 988) immediately.
        </p>
      </div>
    </footer>
  )
}
