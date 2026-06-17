import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { doc, updateDoc } from 'firebase/firestore'
import {
  Heart,
  Brain,
  Smile,
  Activity,
  Award,
  ChevronRight,
  ChevronLeft,
  Check,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { db } from '../lib/firebase.js'
import { useAuth } from '../context/AuthContext.jsx'
import PageTransition from '../components/PageTransition.jsx'

const GOALS = [
  { id: 'anxiety', label: 'Manage anxiety and racing thoughts', icon: Brain, desc: 'Learn to quiet worries and calm panic' },
  { id: 'stress', label: 'Reduce stress and burnout', icon: Activity, desc: 'Restore balance in work, studies, and life' },
  { id: 'sleep', label: 'Improve sleep quality', icon: Heart, desc: 'Quiet your mind before bed for restful sleep' },
  { id: 'relationships', label: 'Strengthen relationships', icon: Smile, desc: 'Communicate boundaries and connect deeply' },
  { id: 'self_esteem', label: 'Boost self-esteem', icon: Award, desc: 'Practice self-compassion and conquer self-doubt' },
]

const GAD7_QUESTIONS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it is hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid, as if something awful might happen',
]

const PHQ9_QUESTIONS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
  'Trouble concentrating on things, such as reading the newspaper or watching television',
  'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual',
  'Thoughts that you would be better off dead or of hurting yourself in some way',
]

const OPTIONS = [
  { label: 'Not at all', score: 0 },
  { label: 'Several days', score: 1 },
  { label: 'More than half the days', score: 2 },
  { label: 'Nearly every day', score: 3 },
]

function getSeverity(score, type) {
  if (type === 'gad7') {
    if (score >= 15) return { label: 'Severe anxiety', color: 'text-red-500 bg-red-500/10' }
    if (score >= 10) return { label: 'Moderate anxiety', color: 'text-orange-500 bg-orange-500/10' }
    if (score >= 5) return { label: 'Mild anxiety', color: 'text-yellow-500 bg-yellow-500/10' }
    return { label: 'Minimal anxiety', color: 'text-emerald-500 bg-emerald-500/10' }
  } else {
    if (score >= 20) return { label: 'Severe depression', color: 'text-red-500 bg-red-500/10' }
    if (score >= 15) return { label: 'Moderately severe depression', color: 'text-rose-500 bg-rose-500/10' }
    if (score >= 10) return { label: 'Moderate depression', color: 'text-orange-500 bg-orange-500/10' }
    if (score >= 5) return { label: 'Mild depression', color: 'text-yellow-500 bg-yellow-500/10' }
    return { label: 'Minimal depression', color: 'text-emerald-500 bg-emerald-500/10' }
  }
}

export default function OnboardingPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1) // 1: Goals, 2: GAD-7, 3: PHQ-9, 4: Summary
  const [selectedGoals, setSelectedGoals] = useState([])
  const [gad7Answers, setGad7Answers] = useState(Array(GAD7_QUESTIONS.length).fill(-1))
  const [phq9Answers, setPhq9Answers] = useState(Array(PHQ9_QUESTIONS.length).fill(-1))
  const [saving, setSaving] = useState(false)

  // Calculations
  const gad7Score = gad7Answers.reduce((a, b) => a + (b >= 0 ? b : 0), 0)
  const phq9Score = phq9Answers.reduce((a, b) => a + (b >= 0 ? b : 0), 0)

  const isStepValid = () => {
    if (step === 1) return selectedGoals.length > 0
    if (step === 2) return gad7Answers.every(ans => ans >= 0)
    if (step === 3) return phq9Answers.every(ans => ans >= 0)
    return true
  }

  const toggleGoal = (id) => {
    setSelectedGoals(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    )
  }

  const handleNext = () => {
    if (isStepValid()) {
      setStep(prev => prev + 1)
    }
  }

  const handleBack = () => {
    setStep(prev => prev - 1)
  }

  const handleSubmit = async () => {
    if (!profile?.uid) return
    setSaving(true)
    try {
      const docRef = doc(db, 'users', profile.uid)
      await updateDoc(docRef, {
        onboarded: true,
        onboarding_gad7: gad7Score,
        onboarding_phq9: phq9Score,
        goals: selectedGoals,
        onboarding_completed_at: Date.now()
      })
      navigate('/dashboard/patient')
    } catch (err) {
      console.error('[Onboarding] Error submitting onboarding baseline:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageTransition>
      <div className="container mx-auto flex min-h-[85vh] flex-col items-center justify-center px-4 py-12">
        {/* Main Card */}
        <div className="w-full max-w-2xl rounded-3xl border border-primary/20 bg-surface-2 p-8 shadow-xl">
          {/* Progress Indicator */}
          <div className="mb-8 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Step {step} of 4 — {step === 1 ? 'Goals' : step === 2 ? 'Anxiety Screening' : step === 3 ? 'Mood Screening' : 'Wellness Baseline'}
            </span>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map(s => (
                <div
                  key={s}
                  className={`h-1.5 w-8 rounded-full transition-all duration-300 ${
                    s <= step ? 'bg-primary' : 'bg-border/60'
                  }`}
                />
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {/* Step 1: Goals */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-6"
              >
                <div className="text-center">
                  <h1 className="text-2xl font-extrabold text-fg">Welcome to MindEase, {profile?.name || 'Friend'}!</h1>
                  <p className="mt-2 text-sm text-muted">
                    Let's personalize your experience. What are your primary wellness goals?
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  {GOALS.map(goal => {
                    const Icon = goal.icon
                    const isSelected = selectedGoals.includes(goal.id)
                    return (
                      <button
                        key={goal.id}
                        onClick={() => toggleGoal(goal.id)}
                        className={`flex items-start gap-4 rounded-2xl border p-4 text-left transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/5 shadow-md shadow-primary/5'
                            : 'border-border bg-surface-3 hover:border-primary/40'
                        }`}
                      >
                        <div className={`mt-0.5 rounded-lg p-2 ${
                          isSelected ? 'bg-primary text-primary-contrast' : 'bg-surface-2 text-muted'
                        }`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-bold text-fg">{goal.label}</p>
                          <p className="text-xs text-muted mt-0.5">{goal.desc}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            )}

            {/* Step 2: GAD-7 */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-6"
              >
                <div>
                  <h2 className="text-xl font-extrabold text-fg flex items-center gap-2">
                    <Brain className="h-5 w-5 text-primary" /> General Anxiety Screening (GAD-7)
                  </h2>
                  <p className="text-xs text-muted mt-1 leading-relaxed">
                    Over the last 2 weeks, how often have you been bothered by the following problems?
                  </p>
                </div>

                <div className="flex flex-col gap-6 max-h-[45vh] overflow-y-auto pr-2">
                  {GAD7_QUESTIONS.map((q, idx) => (
                    <div key={idx} className="flex flex-col gap-3 border-b border-border/40 pb-4 last:border-0">
                      <p className="text-sm font-semibold text-fg">{idx + 1}. {q}</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {OPTIONS.map(opt => {
                          const isSelected = gad7Answers[idx] === opt.score
                          return (
                            <button
                              key={opt.score}
                              onClick={() => {
                                const newAnswers = [...gad7Answers]
                                newAnswers[idx] = opt.score
                                setGad7Answers(newAnswers)
                              }}
                              className={`rounded-xl border p-3 text-center text-xs font-semibold transition-all ${
                                isSelected
                                  ? 'border-primary bg-primary/5 text-primary'
                                  : 'border-border bg-surface-3 hover:border-primary/30 text-muted hover:text-fg'
                              }`}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Step 3: PHQ-9 */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-6"
              >
                <div>
                  <h2 className="text-xl font-extrabold text-fg flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" /> Mood & Energy Screening (PHQ-9)
                  </h2>
                  <p className="text-xs text-muted mt-1 leading-relaxed">
                    Over the last 2 weeks, how often have you been bothered by the following problems?
                  </p>
                </div>

                <div className="flex flex-col gap-6 max-h-[45vh] overflow-y-auto pr-2">
                  {PHQ9_QUESTIONS.map((q, idx) => (
                    <div key={idx} className="flex flex-col gap-3 border-b border-border/40 pb-4 last:border-0">
                      <p className="text-sm font-semibold text-fg">{idx + 1}. {q}</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {OPTIONS.map(opt => {
                          const isSelected = phq9Answers[idx] === opt.score
                          return (
                            <button
                              key={opt.score}
                              onClick={() => {
                                const newAnswers = [...phq9Answers]
                                newAnswers[idx] = opt.score
                                setPhq9Answers(newAnswers)
                              }}
                              className={`rounded-xl border p-3 text-center text-xs font-semibold transition-all ${
                                isSelected
                                  ? 'border-primary bg-primary/5 text-primary'
                                  : 'border-border bg-surface-3 hover:border-primary/30 text-muted hover:text-fg'
                              }`}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Step 4: Summary */}
            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col items-center gap-6 text-center"
              >
                <div className="rounded-2xl bg-primary/10 p-4 text-primary animate-bounce">
                  <Sparkles className="h-10 w-10" />
                </div>

                <div>
                  <h2 className="text-2xl font-extrabold text-fg">Baseline Completed!</h2>
                  <p className="text-sm text-muted mt-2 max-w-md">
                    Thank you for sharing, {profile?.name || 'Friend'}. Your initial clinical wellness baseline is set.
                  </p>
                </div>

                {/* Score Cards */}
                <div className="flex w-full flex-col gap-4 sm:flex-row justify-center">
                  {/* GAD-7 Card */}
                  <div className="flex flex-col items-center rounded-2xl border border-border bg-surface-3 p-5 w-full sm:w-48">
                    <span className="text-xs text-muted font-bold">Anxiety Score</span>
                    <span className="text-3xl font-extrabold text-fg mt-2">{gad7Score} / 21</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-2 uppercase ${getSeverity(gad7Score, 'gad7').color}`}>
                      {getSeverity(gad7Score, 'gad7').label}
                    </span>
                  </div>

                  {/* PHQ-9 Card */}
                  <div className="flex flex-col items-center rounded-2xl border border-border bg-surface-3 p-5 w-full sm:w-48">
                    <span className="text-xs text-muted font-bold">Mood Score</span>
                    <span className="text-3xl font-extrabold text-fg mt-2">{phq9Score} / 27</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-2 uppercase ${getSeverity(phq9Score, 'phq9').color}`}>
                      {getSeverity(phq9Score, 'phq9').label}
                    </span>
                  </div>
                </div>

                <div className="w-full h-px bg-border my-2" />

                <div className="text-left w-full text-xs text-muted leading-relaxed px-2 bg-primary/5 p-4 rounded-xl border border-primary/10">
                  <p className="font-bold text-fg mb-1">What happens next?</p>
                  We have tailored your companion, Rahat 🌱, and your wellness recommendations based on your goals. You can track your trends over time, log habits, use guided meditation, and access secure consultations with licensed mental health experts whenever you need.
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation Buttons */}
          <div className="mt-8 flex justify-between gap-4 border-t border-border/55 pt-6">
            {step > 1 ? (
              <button
                onClick={handleBack}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-bold text-muted transition hover:border-primary/50 hover:text-fg disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <div />
            )}

            {step < 4 ? (
              <button
                onClick={handleNext}
                disabled={!isStepValid()}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-contrast shadow-md transition hover:bg-primary/95 hover:shadow-lg disabled:opacity-50 disabled:pointer-events-none"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-contrast shadow-md transition hover:bg-primary/95 hover:shadow-lg disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    Complete <Check className="h-4 w-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  )
}
