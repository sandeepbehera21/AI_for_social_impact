import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  ShieldCheck,
  Heart,
  Smile,
  Activity,
  Sparkles,
  Clock,
  Video,
  FileSignature,
  LifeBuoy,
  ArrowRight,
  ChevronRight,
  Plus,
  Minus,
  Info,
  Calendar,
  User,
  Stethoscope,
  Compass,
  BookOpen,
  Check,
  MessageSquare,
  AlertTriangle,
  Shield,
  CheckCircle2,
  ChevronDown
} from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'

export default function HomePage() {
  const [activeFaq, setActiveFaq] = useState(null)
  const [activeJourneyStep, setActiveJourneyStep] = useState(0)
  const [selectedMood, setSelectedMood] = useState('anxious')
  const [breathingStage, setBreathingStage] = useState(0) // 0: In, 1: Hold, 2: Out, 3: Hold

  useEffect(() => {
    const interval = setInterval(() => {
      setBreathingStage((prev) => (prev + 1) % 4)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const moods = [
    { key: 'anxious', label: 'Anxious 😟', text: 'Calm your heart rate with slow box breathing.' },
    { key: 'sad', label: 'Sad 😢', text: 'Gentle reflection and self-compassion breathing.' },
    { key: 'restless', label: 'Restless 🥱', text: 'Find your center with a rhythmic breathing cycle.' },
    { key: 'peaceful', label: 'Peaceful 😌', text: 'Sustain your grounded tranquility and stability.' },
    { key: 'joyful', label: 'Joyful 😊', text: 'Radiate positive energy throughout your day.' },
  ]

  const moodRecommendations = {
    anxious: {
      tool: 'Anxiety Mapping CBT',
      desc: 'Map out catastrophic thoughts and regain control using our cognitive restructuring guide.',
      link: '/cbt',
      badge: 'CBT Worksheet',
      color: 'var(--warning)',
      bg: 'var(--warning-soft)'
    },
    sad: {
      tool: 'Gratitude Reflection Journal',
      desc: 'Re-center your mind on small wins and positive events to gently lift your emotional state.',
      link: '/journal',
      badge: 'Reflective Journal',
      color: 'var(--accent)',
      bg: 'var(--accent-soft)'
    },
    restless: {
      tool: 'Nature Sound Sanctuary',
      desc: 'Blend ocean tide waves and rain tracks to calm your physical nervous system.',
      link: '/meditation',
      badge: 'Ambient Mixer',
      color: 'var(--primary)',
      bg: 'var(--primary-soft)'
    },
    peaceful: {
      tool: 'Daily Habit Tracker',
      desc: 'Maintain your balanced health routine by logging sleep and meditation check-ins.',
      link: '/habits',
      badge: 'Habits Logging',
      color: 'var(--success)',
      bg: 'var(--success-soft)'
    },
    joyful: {
      tool: 'Thought Reframing Guide',
      desc: 'Reinforce positive behavioral schemas and document what made you feel fulfilled today.',
      link: '/cbt',
      badge: 'Clinical CBT',
      color: 'var(--primary)',
      bg: 'var(--primary-soft)'
    }
  }

  const toggleFaq = (index) => {
    setActiveFaq(activeFaq === index ? null : index)
  }

  // 11 Sections content data definitions

  const timelineSteps = [
    {
      step: '01',
      title: 'Daily Check-In',
      desc: 'Log your emotional status using our quick trackers. You can optionally use on-device face meshes for micro-expression alignment.',
      icon: Smile
    },
    {
      step: '02',
      title: 'AI & Mood Analysis',
      desc: 'Get immediate cognitive analytics on your mood logs. Discover subconscious stressors, emotional shifts, and sentiment indicators.',
      icon: Brain
    },
    {
      step: '03',
      title: 'Personalized Guidance',
      desc: 'The platform aggregates check-ins to deliver custom self-care recommendations directly on your patient dashboard.',
      icon: Compass
    },
    {
      step: '04',
      title: 'CBT & Journaling',
      desc: 'Work through structured worksheets, thought reframing models, and write encrypted reflections in your private journal.',
      icon: BookOpen
    },
    {
      step: '05',
      title: 'Professional Care',
      desc: 'For deeper clinical support, book time-gated slots with licensed doctors and meet in our secure high-definition video room.',
      icon: Video
    }
  ]

  const features = [
    {
      icon: MessageSquare,
      title: 'AI Therapeutic Chat',
      desc: 'Chat with Rahat, an empathetic virtual agent trained to provide grounding exercises, coping mechanisms, and general CBT support.',
      link: '/chat',
      tag: 'Self-Care'
    },
    {
      icon: Smile,
      title: 'Emotion Analysis',
      desc: 'On-device camera expression mapping detects facial micro-states without saving, sharing, or transmitting your video stream.',
      link: '/chat',
      tag: 'On-Device'
    },
    {
      icon: BookOpen,
      title: 'Reflective Journal',
      desc: 'A digital sanctuary to write thoughts. Filter by mood, search by keyword, and tag the 11 key stressors affecting your day.',
      link: '/journal',
      tag: 'Encrypted'
    },
    {
      icon: FileSignature,
      title: 'CBT Worksheets',
      desc: 'Complete cognitive restructuring templates including Thought Reframing, Anxiety Mapping, Stress Limits, and Gratitude logs.',
      link: '/cbt',
      tag: 'Cognitive'
    },
    {
      icon: Compass,
      title: 'Meditation Sanctuary',
      desc: 'An ambient audio mixer, daily self-reflections, and full-screen guided box breathing to help you return to the present moment.',
      link: '/meditation',
      tag: 'Sanctuary'
    },
    {
      icon: Activity,
      title: 'Habit Tracker',
      desc: 'Log and monitor your clinical wellness habits, meditation streaks, sleep schedules, and physical activity indicators.',
      link: '/habits',
      tag: 'Growth'
    },
    {
      icon: Video,
      title: 'Video Consultation',
      desc: 'Connect live with certified medical doctors. Enforces strict participant authentication and a secure join-window timer.',
      link: '/consult-doc',
      tag: 'Clinical'
    },
    {
      icon: CheckCircle2,
      title: 'Session Reports',
      desc: 'Attending doctors generate diagnosis summaries cryptographically signed with private keys for verified patient medical history.',
      link: '/consult-doc',
      tag: 'Signed'
    }
  ]

  const journeySteps = [
    {
      stage: 'Reflect',
      action: 'Notice Triggers',
      desc: 'Log your feelings, behaviors, and stressors to build a clear snapshot of your emotional state.'
    },
    {
      stage: 'Understand',
      action: 'Extract Insights',
      desc: 'Analyze cognitive patterns and mood trends with safe, AI-assisted sentiment summaries.'
    },
    {
      stage: 'Improve',
      action: 'Apply Self-Care',
      desc: 'Engage with guided breathing, meditation, and structured thought reframing sheets.'
    },
    {
      stage: 'Heal',
      action: 'Build Stability',
      desc: 'Connect with medical experts, verify outcomes, and cultivate long-term mental resilience.'
    }
  ]

  const testimonials = [
    {
      quote: "The combination of private daily journaling and AI check-ins helped me notice my anxiety triggers before they escalated. It feels like a genuine companion.",
      author: "Sarah M.",
      role: "User since 2024",
      avatar: "SM"
    },
    {
      quote: "MindEase handles clinical consultation so professionally. Moving from my CBT worksheets straight to a secure video consult with my psychologist was seamless.",
      author: "David L.",
      role: "Outpatient Patient",
      avatar: "DL"
    },
    {
      quote: "As a clinician, I appreciate the cryptographic signing for session notes and the strict privacy. It provides a level of trust that is rare in digital health.",
      author: "Dr. Elena R.",
      role: "Board-Certified Psychiatrist",
      avatar: "ER"
    }
  ]

  const faqs = [
    {
      q: "Is my personal data private and secure?",
      a: "Yes. Privacy is a core architectural pillar of MindEase. All camera-based emotion tracking runs locally on-device via Web APIs (no video is ever sent to a server). Your journal entries and CBT worksheets are stored securely and are protected by access-control rules. Clinical session reports are encrypted and cryptographically signed."
    },
    {
      q: "Is Rahat AI a replacement for professional therapy?",
      a: "No. Rahat is a supportive AI companion designed for daily check-ins, mood tracking, and CBT self-care exercises. It does not provide medical diagnoses or replace licensed clinical therapy. For clinical needs, MindEase connects you directly with certified doctors via secure video consultations."
    },
    {
      q: "How do video consultations and booking slots work?",
      a: "Patients can browse certified doctors, view schedules, and book slots under 'Consult Doc'. Once the doctor approves the request, a secure time-gated video consultation is initialized. The join button becomes active 5 minutes before the session and expires 15 minutes after the scheduled start time to guarantee session integrity."
    },
    {
      q: "How are session reports and prescriptions signed?",
      a: "Upon completing a video consult, the doctor enters session summaries, diagnoses, and prescriptions. The system signs these documents using the doctor's RSA-2048 private key. Patients receive these signed summaries in their portal, which can be clinically verified for authenticity."
    }
  ]

  return (
    <PageTransition>
      <div className="relative overflow-hidden bg-bg text-fg min-h-screen">
        
        {/* Ambient Serene Background Blobs */}
        <div
          className="pointer-events-none absolute -left-48 top-20 h-[500px] w-[500px] rounded-full blur-[120px] opacity-40 dark:opacity-20"
          style={{ background: 'var(--bg-tint-1)' }}
        />
        <div
          className="pointer-events-none absolute right-[-200px] top-[400px] h-[550px] w-[550px] rounded-full blur-[140px] opacity-40 dark:opacity-20"
          style={{ background: 'var(--bg-tint-2)' }}
        />

        {/* ── 2. HERO SECTION ── */}
        <section className="relative px-6 pt-16 pb-20 md:pt-28 md:pb-28">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
              
              {/* Left Column: Heading and CTAs */}
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                className="lg:col-span-7 text-center lg:text-left"
              >
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary-soft/40 px-3.5 py-1 text-xs font-semibold text-primary mb-6 shadow-sm">
                  <Sparkles className="h-3.5 w-3.5" />
                  Your secure wellness sanctuary
                </div>
                
                <h1 className="text-4xl font-extrabold tracking-tight leading-tight md:text-5xl lg:text-6xl text-fg">
                  Your safe space for <br />
                  <span className="text-primary font-black bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">better mental wellbeing.</span>
                </h1>
                
                <p className="mt-6 text-base md:text-lg leading-relaxed text-muted max-w-xl mx-auto lg:mx-0">
                  Track emotions, journal your thoughts, talk with an AI companion, and connect with licensed professionals—all in one secure place.
                </p>
                
                <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                  <Link
                    to="/chat"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-primary px-8 py-3.5 font-semibold text-primary-fg shadow-md hover:bg-primary-hover hover:shadow-lg active:scale-95 transition-all duration-200 cursor-pointer"
                  >
                    <Smile className="h-5 w-5" />
                    Start Your Check-In
                  </Link>
                  <Link
                    to="/consult-doc"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-8 py-3.5 font-semibold text-fg hover:border-primary hover:text-primary active:scale-95 transition-all duration-200 cursor-pointer"
                  >
                    <Stethoscope className="h-5 w-5 text-muted" />
                    Talk to a Doctor
                  </Link>
                </div>

                {/* Micro trust indicators */}
                <div className="mt-8 flex items-center justify-center lg:justify-start gap-6 text-xs text-muted">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-success" />
                    On-Device Face Mesh
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    Clinical Safety Assured
                  </div>
                </div>
              </motion.div>

              {/* Right Column: Hero Visual */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.7, delay: 0.2 }}
                className="lg:col-span-5 flex justify-center"
              >
                <div className="relative w-full max-w-md">
                  {/* Decorative glowing gradient backdrop */}
                  <div className="absolute inset-0 -z-10 bg-gradient-to-tr from-primary/10 to-accent/15 rounded-[2.5rem] blur-3xl" />
                  
                  {/* Premium Wellness Hero Illustration */}
                  <div className="rounded-[2.5rem] border border-border bg-surface p-2 shadow-lg overflow-hidden animate-float">
                    <img
                      src="/assets/wellness_hero.png"
                      alt="MindEase mental wellness and serenity illustration"
                      className="w-full h-auto rounded-[2.2rem]"
                    />
                  </div>
                </div>
              </motion.div>

            </div>
          </div>
        </section>

        {/* ── 3. INTERACTIVE BREATHING & MOOD SANCTUARY ── */}
        <section className="px-6 py-16 border-t border-b border-border bg-surface-2/20 backdrop-blur-sm relative overflow-hidden">
          <div className="mx-auto max-w-6xl relative z-10">
            <div className="text-center max-w-2xl mx-auto mb-10">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft text-primary px-3 py-1 text-xs font-semibold mb-3">
                <Heart className="h-3.5 w-3.5" /> Interactive Sanctuary
              </span>
              <h2 className="text-3xl font-extrabold tracking-tight text-fg">Calm your mind, right now</h2>
              <p className="text-sm text-muted mt-2">Choose your current state and practice a 4-second box-breathing cycle to re-center.</p>
            </div>

            {/* Interactive Mood Selectors */}
            <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
              {moods.map((m) => {
                const active = selectedMood === m.key
                return (
                  <button
                    key={m.key}
                    onClick={() => setSelectedMood(m.key)}
                    className={`rounded-full px-5 py-2.5 text-xs font-bold transition-all duration-300 transform active:scale-95 cursor-pointer border ${
                      active
                        ? 'bg-primary border-primary text-primary-fg shadow-md scale-105'
                        : 'bg-surface border-border text-muted hover:border-primary/40 hover:text-fg'
                    }`}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>

            {/* Breathing Simulator & Recommendations Grid */}
            <div className="grid gap-8 md:grid-cols-12 md:items-center max-w-4xl mx-auto">
              
              {/* Left Side: Animated Breathing Orb */}
              <div className="md:col-span-5 flex flex-col items-center justify-center py-6">
                <div className="relative flex items-center justify-center h-48 w-48">
                  {/* Concentric ambient background circle */}
                  <motion.div
                    animate={{
                      scale: breathingStage === 0 || breathingStage === 1 ? 1.4 : 1,
                      opacity: breathingStage === 1 ? 0.35 : 0.15
                    }}
                    transition={{ duration: 4, ease: 'easeInOut' }}
                    className="absolute h-36 w-36 rounded-full bg-primary/20 blur-sm"
                  />
                  {/* Concentric outer pulsing circle */}
                  <motion.div
                    animate={{
                      scale: breathingStage === 0 || breathingStage === 1 ? 1.25 : 1
                    }}
                    transition={{ duration: 4, ease: 'easeInOut' }}
                    className="absolute h-32 w-32 rounded-full border border-primary/20"
                  />
                  {/* Core Breathing Orb */}
                  <motion.div
                    animate={{
                      scale: breathingStage === 0 || breathingStage === 1 ? 1.15 : 1
                    }}
                    transition={{ duration: 4, ease: 'easeInOut' }}
                    className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent shadow-float text-center p-3"
                  >
                    <span className="text-xs font-black text-primary-fg select-none transition-opacity duration-300">
                      {breathingStage === 0 && 'Breathe In'}
                      {breathingStage === 1 && 'Hold'}
                      {breathingStage === 2 && 'Breathe Out'}
                      {breathingStage === 3 && 'Hold'}
                    </span>
                  </motion.div>
                </div>
                <div className="mt-4 text-center">
                  <p className="text-xs text-muted font-medium">{moods.find(m => m.key === selectedMood)?.text}</p>
                </div>
              </div>

              {/* Right Side: Smart Recommendation Box */}
              <div className="md:col-span-7">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedMood}
                    initial={{ opacity: 0, x: 15 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -15 }}
                    transition={{ duration: 0.3 }}
                    className="card p-6 bg-surface border-border shadow-sm flex flex-col justify-between h-full relative overflow-hidden"
                  >
                    <div
                      className="absolute -right-12 -top-12 h-28 w-28 rounded-full opacity-10 blur-xl"
                      style={{ background: moodRecommendations[selectedMood].color }}
                    />
                    <div>
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider mb-4"
                        style={{ backgroundColor: moodRecommendations[selectedMood].bg, color: moodRecommendations[selectedMood].color }}
                      >
                        {moodRecommendations[selectedMood].badge}
                      </span>
                      <h3 className="text-lg font-extrabold text-fg mb-2">
                        {moodRecommendations[selectedMood].tool}
                      </h3>
                      <p className="text-xs leading-relaxed text-muted mb-6">
                        {moodRecommendations[selectedMood].desc}
                      </p>
                    </div>

                    <Link
                      to={moodRecommendations[selectedMood].link}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-fg shadow-sm hover:bg-primary-hover transition-colors self-start cursor-pointer"
                    >
                      Open Coping Exercise <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </motion.div>
                </AnimatePresence>
              </div>

            </div>
          </div>
        </section>

        {/* ── 4. HOW IT WORKS TIMELINE ── */}
        <section className="px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight text-fg">Your simple path to stability</h2>
              <p className="text-base text-muted mt-3">From daily emotional check-ins to virtual face-to-face clinical consultations.</p>
            </div>

            <div className="relative">
              {/* Central connection line (desktop only) */}
              <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-border -translate-y-1/2 hidden lg:block" />

              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5 relative z-10">
                {timelineSteps.map((step, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: idx * 0.1 }}
                    className="flex flex-col items-center lg:items-start text-center lg:text-left bg-surface border border-border p-6 rounded-2xl shadow-sm hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center justify-between w-full mb-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
                        <step.icon className="h-6 w-6" />
                      </div>
                      <span className="text-2xl font-black text-faint opacity-40">{step.step}</span>
                    </div>
                    <h3 className="text-base font-bold text-fg mb-2">{step.title}</h3>
                    <p className="text-xs leading-relaxed text-muted">{step.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 5. WELLNESS FEATURE GRID ── */}
        <section className="px-6 py-20 border-t border-border bg-surface-2/20">
          <div className="mx-auto max-w-6xl">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight text-fg font-black">A unified digital care ecosystem</h2>
              <p className="text-base text-muted mt-3">Explore the suite of self-care and professional clinical tools available in one portal.</p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((f, idx) => (
                <div key={idx} className="card p-6 bg-surface border-border flex flex-col justify-between hover:shadow-md transition-shadow group">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-fg">
                        <f.icon className="h-5 w-5" />
                      </div>
                      <span className="text-[10px] font-semibold tracking-wide text-primary bg-primary-soft/50 px-2 py-0.5 rounded-full">{f.tag}</span>
                    </div>
                    <h3 className="text-base font-bold text-fg mb-2">{f.title}</h3>
                    <p className="text-xs leading-relaxed text-muted mb-4">{f.desc}</p>
                  </div>
                  <Link
                    to={f.link}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover self-start group/link mt-2"
                  >
                    Open Workspace
                    <ChevronRight className="h-3 w-3 transition-transform group-hover/link:translate-x-1" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 6. MENTAL HEALTH JOURNEY SECTION ── */}
        <section className="px-6 py-20 border-b border-border">
          <div className="mx-auto max-w-4xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight text-fg">The Healing Cycle</h2>
              <p className="text-base text-muted mt-3">An ongoing, cyclical process of emotional mindfulness and active improvement.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {journeySteps.map((step, idx) => (
                <div
                  key={idx}
                  onClick={() => setActiveJourneyStep(idx)}
                  className={`cursor-pointer p-6 rounded-2xl border text-center transition-all duration-300 ${
                    activeJourneyStep === idx
                      ? 'bg-primary text-primary-fg border-primary shadow-md scale-105'
                      : 'bg-surface border-border hover:border-primary/50 text-fg'
                  }`}
                >
                  <span className={`text-[10px] uppercase font-bold tracking-widest ${activeJourneyStep === idx ? 'text-primary-fg/80' : 'text-primary'}`}>Stage {idx + 1}</span>
                  <h3 className="text-lg font-extrabold mt-2 mb-1">{step.stage}</h3>
                  <p className={`text-xs ${activeJourneyStep === idx ? 'text-primary-fg/90' : 'text-muted'}`}>{step.action}</p>
                </div>
              ))}
            </div>

            {/* Dynamic display block for active step */}
            <div className="mt-8 p-6 rounded-2xl bg-surface border border-border text-center shadow-sm">
              <motion.div
                key={activeJourneyStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-xl mx-auto"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary mx-auto mb-3">
                  <Compass className="h-5 w-5" />
                </div>
                <h4 className="text-base font-bold text-fg mb-2">How you {journeySteps[activeJourneyStep].stage.toLowerCase()}:</h4>
                <p className="text-sm leading-relaxed text-muted">{journeySteps[activeJourneyStep].desc}</p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── 7. TESTIMONIALS SECTION ── */}
        <section className="px-6 py-20 bg-surface-2/10">
          <div className="mx-auto max-w-6xl">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight text-fg">Stories of resilience and hope</h2>
              <p className="text-base text-muted mt-3">Hear how members use MindEase to guide their mental health care paths.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {testimonials.map((t, idx) => (
                <div key={idx} className="card p-6 bg-surface border-border flex flex-col justify-between hover:shadow-md transition-shadow">
                  <p className="text-sm italic leading-relaxed text-muted mb-6">"{t.quote}"</p>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary border border-primary/10">
                      {t.avatar}
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-fg">{t.author}</h4>
                      <p className="text-[10px] text-faint uppercase font-bold tracking-wider">{t.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 9. FAQ SECTION ── */}
        <section className="px-6 py-20 border-t border-border bg-surface-2/20">
          <div className="mx-auto max-w-4xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight text-fg">Frequently Asked Questions</h2>
              <p className="text-base text-muted mt-3">Clear, transparent answers about our clinical models, privacy, and consultations.</p>
            </div>

            <div className="space-y-4">
              {faqs.map((faq, idx) => {
                const isOpen = activeFaq === idx
                return (
                  <div key={idx} className="rounded-2xl border border-border bg-surface overflow-hidden transition-all duration-300">
                    <button
                      onClick={() => toggleFaq(idx)}
                      className="flex w-full items-center justify-between px-6 py-4.5 text-left font-bold text-fg hover:bg-surface-2/40 transition-colors"
                    >
                      <span className="text-sm md:text-base">{faq.q}</span>
                      <ChevronDown className={`h-5 w-5 text-muted transition-transform duration-300 ${isOpen ? 'rotate-180 text-primary' : ''}`} />
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: 'easeInOut' }}
                        >
                          <div className="border-t border-border px-6 py-4.5 text-xs md:text-sm leading-relaxed text-muted bg-surface-2/10">
                            {faq.a}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── 10. EMERGENCY CRISIS BANNER ── */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-4xl">
            <div className="rounded-3xl border border-danger/25 bg-danger-soft p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
              <div className="flex items-start gap-4 text-center md:text-left">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-danger text-danger-fg mx-auto md:mx-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base md:text-lg font-black text-danger">Immediate Crisis Support</h3>
                  <p className="text-xs md:text-sm leading-relaxed text-danger mt-1.5 opacity-90">
                    If you are experiencing thoughts of self-harm or a severe medical emergency, please contact local emergency services immediately. Rahat AI and our portal schedules are not crisis services.
                  </p>
                </div>
              </div>
              <Link
                to="/sos"
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-danger px-6 py-3.5 font-bold text-danger-fg shadow hover:bg-danger/90 active:scale-95 transition-all shrink-0 cursor-pointer"
              >
                <LifeBuoy className="h-4 w-4" />
                Access SOS Center
              </Link>
            </div>
          </div>
        </section>

        {/* Global Footer is rendered by App.jsx at the root layout level */}

      </div>
    </PageTransition>
  )
}
