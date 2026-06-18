import { Brain, Heart } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="w-full bg-[#fafafa] text-[#13211c] dark:bg-[#070b09] dark:text-[#e7f0ec] transition-colors duration-300 border-t border-border/10">
      
      {/* ── Liquid Chrome Metallic Banner ── */}
      <div className="h-4 w-full liquid-chrome-banner shadow-inner" />

      <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">
        
        {/* ── Brand Visual Section ── */}
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row border-b border-border/10 pb-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary shadow-sm">
              <Brain className="h-5 w-5" />
            </span>
            <div>
              <span className="brand-text text-xl font-black tracking-tight block">MindEase</span>
              <span className="text-[10px] text-faint uppercase tracking-widest font-bold block mt-0.5">AI Mental Health Portal</span>
            </div>
          </div>
          <p className="max-w-md text-center text-xs leading-relaxed text-muted md:text-right">
            An integrated therapeutic portal combining secure on-device cognitive tracking, evidence-based CBT exercises, private reflections, and time-gated clinical video consultations.
          </p>
        </div>

        {/* ── Giant Typographic Title ── */}
        <div 
          className="w-full select-none text-center font-black tracking-tighter uppercase leading-none my-8 md:my-12 text-fg opacity-90 transition-all duration-300"
          style={{ fontSize: 'clamp(2.2rem, 12.5vw, 9.5rem)' }}
        >
          MindEase AI
        </div>

        {/* ── Footer Navigation & Helplines Grid ── */}
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4 text-xs mt-8 border-t border-border/10 pt-10">
          
          {/* Column 1: Sitemap */}
          <div>
            <h4 className="text-xxs uppercase font-extrabold tracking-widest text-fg mb-4 border-b border-border/10 pb-2">
              Sitemap
            </h4>
            <ul className="space-y-3 font-semibold uppercase tracking-wider text-muted">
              <li>
                <Link to="/" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/chat" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  AI Therapeutic Chat
                </Link>
              </li>
              <li>
                <Link to="/meditation" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  Meditation Sanctuary
                </Link>
              </li>
              <li>
                <Link to="/cbt" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  CBT Worksheets
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 2: Portals */}
          <div>
            <h4 className="text-xxs uppercase font-extrabold tracking-widest text-fg mb-4 border-b border-border/10 pb-2">
              Portals &amp; Support
            </h4>
            <ul className="space-y-3 font-semibold uppercase tracking-wider text-muted">
              <li>
                <Link to="/about" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  About MindEase
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  Contact Team
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  Clinician &amp; Patient Sign In
                </Link>
              </li>
              <li>
                <Link to="/sos" className="hover:text-danger transition-all duration-200 hover:translate-x-1 inline-block text-danger">
                  SOS Emergency Center
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: India Crisis Helplines */}
          <div>
            <h4 className="text-xxs uppercase font-extrabold tracking-widest text-fg mb-4 border-b border-border/10 pb-2">
              Crisis Help (India)
            </h4>
            <ul className="space-y-3 text-muted">
              <li>
                <div className="text-[10px] uppercase font-bold text-faint tracking-wider mb-0.5">Kiran Mental Health</div>
                <a href="tel:18005990019" className="hover:text-danger transition-colors font-mono font-bold text-sm">
                  1800-599-0019
                </a>
              </li>
              <li>
                <div className="text-[10px] uppercase font-bold text-faint tracking-wider mb-0.5">Tele-MANAS</div>
                <a href="tel:14416" className="hover:text-danger transition-colors font-mono font-bold text-sm">
                  14416 / 1800-891-4416
                </a>
              </li>
              <li>
                <div className="text-[10px] uppercase font-bold text-faint tracking-wider mb-0.5">National Emergency</div>
                <a href="tel:112" className="hover:text-danger transition-colors font-mono font-bold text-sm">
                  112 (Police/Medical)
                </a>
              </li>
              <li>
                <div className="text-[10px] uppercase font-bold text-faint tracking-wider mb-0.5">Aasra Crisis Support</div>
                <a href="tel:+919820466726" className="hover:text-danger transition-colors font-mono font-bold text-sm">
                  +91-9820466726
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: Legal */}
          <div>
            <h4 className="text-xxs uppercase font-extrabold tracking-widest text-fg mb-4 border-b border-border/10 pb-2">
              Legal Info
            </h4>
            <ul className="space-y-3 font-semibold uppercase tracking-wider text-muted">
              <li>
                <Link to="/privacy" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/cookies" className="hover:text-primary transition-all duration-200 hover:translate-x-1 inline-block">
                  Cookie Policy
                </Link>
              </li>
            </ul>
          </div>

        </div>

        {/* ── Sub-Footer Copyright & Tagline ── */}
        <div className="border-t border-border/10 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xxs text-faint uppercase font-bold tracking-widest">
          <div>
            © {new Date().getFullYear()} MINDEASE. ALL RIGHTS RESERVED.
          </div>
          <div className="flex items-center gap-1.5 text-primary">
            <span>HEAL, GROW, THRIVE</span>
            <Heart className="h-3 w-3 fill-primary" />
          </div>
        </div>

        {/* ── AI Support & Clinical Safety Notice ── */}
        <div className="mt-8 pt-6 border-t border-border/10 text-[10px] text-faint leading-relaxed max-w-4xl mx-auto text-center">
          <p className="mb-2">
            <strong className="text-muted">AI SUPPORT NOTICE:</strong> MindEase and its virtual companion Rahat provide general supportive guidance and educational tools. Rahat is not a medical professional, psychiatrist, or crisis intervention service.
          </p>
          <p>
            If you are experiencing a mental health crisis or require clinical assistance, please contact emergency services (such as <a href="tel:112" className="underline hover:text-danger transition-colors font-semibold">112</a>, KIRAN helpline: <a href="tel:18005990019" className="underline hover:text-danger transition-colors font-semibold">1800-599-0019</a>, or Tele-MANAS: <a href="tel:14416" className="underline hover:text-danger transition-colors font-semibold">14416</a>) immediately. Digital services do not replace physical clinical interventions.
          </p>
        </div>

      </div>
    </footer>
  )
}
