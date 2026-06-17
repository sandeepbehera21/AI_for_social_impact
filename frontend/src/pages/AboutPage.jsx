import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Brain,
  ShieldCheck,
  Eye,
  HeartHandshake,
  Sparkles,
  Stethoscope,
  Lock,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'

export default function AboutPage() {
  const features = [
    {
      icon: Sparkles,
      title: 'Rahat: 100% Offline AI',
      desc: 'Our virtual wellness companion runs fully client-side on your device. Your conversations are processed locally, ensuring total privacy without sending any chat data to external LLMs or third-party servers.',
    },
    {
      icon: Lock,
      title: 'AES-256 Envelope Encryption',
      desc: 'All clinical reports, diagnosis details, and prescriptions are sealed at rest with industrial-strength AES-256-GCM. Free-text fields are unreadable by any database administrators or unauthorized eyes.',
    },
    {
      icon: Eye,
      title: 'Clinician Access Transparency',
      desc: 'MindEase records every clinician access event into an immutable, patient-facing consent log. You can audit exactly when, by whom, and what clinical categories were accessed in real-time from your dashboard.',
    },
    {
      icon: Stethoscope,
      title: 'Secure Telehealth Integrations',
      desc: 'Join video consultations with qualified mental health professionals securely. Tokens are generated and validated on-demand, restricting access to verified parties during scheduled session windows.',
    },
    {
      icon: ShieldCheck,
      title: 'Granular Sharing Consent',
      desc: 'You hold full sovereignty over your data. Opt-in or opt-out of sharing your journals, CBT records, mood history, or habit logs with your attending clinician at any time with a single switch.',
    },
    {
      icon: HeartHandshake,
      title: 'Evidence-Based Frameworks',
      desc: 'Our onboarding baseline screening tracks standard clinical measurements (GAD-7 for anxiety, PHQ-9 for depression), establishing a safe baseline for customized self-care recommendations.',
    },
  ]

  return (
    <PageTransition className="mx-auto max-w-5xl px-5 py-12">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface-2 px-8 py-16 text-center shadow-xl md:py-24">
        <div className="absolute inset-0 -z-10 bg-radial-[at_top_right] from-primary/10 via-transparent to-transparent" />
        <div className="mx-auto max-w-2xl">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary"
          >
            <Brain className="h-8 w-8" />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-4xl font-extrabold tracking-tight text-fg md:text-5xl"
          >
            Private, Secure, <span className="brand-text">Compassionate</span> Care
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-6 text-lg leading-relaxed text-muted"
          >
            MindEase is built on a simple foundation: mental health support should be accessible
            without exposing your most personal thoughts. We fuse local AI companion technology
            with strict cryptographic safeguards and patient-first audit logging.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="mt-8 flex flex-wrap justify-center gap-4"
          >
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-fg shadow-md transition hover:bg-primary-hover hover:-translate-y-0.5"
            >
              Get Started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/chat"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-6 py-3 font-semibold text-fg transition hover:bg-surface-2 hover:-translate-y-0.5"
            >
              Talk with Rahat
            </Link>
          </motion.div>
        </div>
      </div>

      {/* Safety Notice Banner */}
      <div className="mt-12 flex flex-col items-center gap-4 rounded-2xl border border-warning/30 bg-warning-soft p-5 text-warning md:flex-row md:gap-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface text-warning shadow-sm">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div>
          <h3 className="font-bold text-fg">AI Support Disclaimer</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            MindEase provides supportive guidance, breathing exercises, and educational tools to help
            you manage everyday wellness. Our offline AI companion, Rahat, is not a licensed counselor,
            clinical therapist, or crisis response system. If you are experiencing acute distress or thoughts
            of self-harm, please reach out to professional services (like 911 or the 988 lifeline) immediately.
          </p>
        </div>
      </div>

      {/* Our Technology Grid */}
      <div className="mt-16">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-fg">Privacy-First Architecture</h2>
          <p className="mt-3 text-sm text-muted">
            How we protect your mental health data every single step of the way.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feat, idx) => {
            const Icon = feat.icon
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: idx * 0.05 }}
                className="card flex flex-col gap-4 p-6 shadow-sm transition hover:shadow-md"
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-fg">{feat.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{feat.desc}</p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Rationale and Philosophy */}
      <div className="card mt-16 p-8 shadow-sm md:p-12">
        <h2 className="text-2xl font-extrabold text-fg md:text-3xl">The Philosophy Behind MindEase</h2>
        <div className="mt-6 space-y-6 text-sm leading-relaxed text-muted">
          <p>
            Traditional digital health applications often trade off privacy for intelligence by transmitting
            sensitive journal notes and chats to server-side engines. MindEase was engineered to prove that
            meaningful, supportive mental health companionship can coexist with complete offline confidentiality.
          </p>
          <p>
            By executing emotion recognition models directly inside your browser and storing clinical
            histories under localized cryptographic seals, MindEase ensures you never have to worry about
            who has access to your thoughts. When you do choose to connect with a clinical therapist,
            our transparent auditing logs let you manage consent in real-time.
          </p>
        </div>
      </div>
    </PageTransition>
  )
}
