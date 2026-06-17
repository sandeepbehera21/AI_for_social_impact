import { useMemo, useState } from 'react'
import {
  Activity,
  Brain,
  HeartPulse,
  ShieldAlert,
  ListChecks,
  PieChart,
  TrendingUp,
  Loader2,
} from 'lucide-react'
import DoctorLayout from '../components/DoctorLayout.jsx'
import { Panel, EmptyState } from '../components/DoctorPrimitives.jsx'
import { LineChart, DonutChart, BarChart, RadialGauge } from '../components/DoctorCharts.jsx'
import { useDoctorPatients } from '../hooks/useDoctorPatients.js'
import { buildAnalytics, TREND_LABELS, RISK_TIERS } from '../lib/doctorData.js'
import { EMOTION_META } from '../lib/moodHistory.js'

const PERIODS = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
]

export default function AnalyticsPage() {
  const { patients, loadingSummaries } = useDoctorPatients()
  const [period, setPeriod] = useState('weekly')

  if (window.location.search.includes('trigger-error=true')) {
    throw new Error('Simulated doctor analytics runtime crash for layout-level Error Boundary verification.')
  }

  const a = useMemo(() => buildAnalytics(patients, period), [patients, period])
  const labels = TREND_LABELS[period]

  const hasData = patients.length > 0 && a.patientsWithData > 0

  const riskDonut = [
    { label: 'High', value: a.riskDist.high, color: RISK_TIERS.high.color },
    { label: 'Medium', value: a.riskDist.medium, color: RISK_TIERS.medium.color },
    { label: 'Low', value: a.riskDist.low, color: RISK_TIERS.low.color },
  ]
  const emotionDonut = a.emotionDist
    .filter((e) => e.value > 0)
    .map((e) => ({ label: e.emotion, value: e.value, color: EMOTION_META[e.emotion]?.color || '#94a3b8' }))

  return (
    <DoctorLayout
      title="Clinical Analytics"
      subtitle="Patient outcomes, emotional trends, and engagement across your panel."
      actions={
        <div className="flex gap-1 rounded-xl border border-border bg-surface-2 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                period === p.key ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      }
    >
      {loadingSummaries && patients.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" /> Aggregating clinical analytics…
        </div>
      ) : !hasData ? (
        <EmptyState
          icon={PieChart}
          title="No analytics data yet"
          hint="Charts populate as your patients log mood, habits, journals and CBT exercises."
        />
      ) : (
        <div className="space-y-6">
          {/* Headline gauges */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <GaugeCard label="Avg Wellness" value={a.avgWellness} color="var(--primary)" />
            <GaugeCard label="Plan Adherence" value={a.planAdherence} color="var(--accent)" />
            <GaugeCard label="CBT Engagement" value={a.cbtCompletion} color="var(--success)" />
            <GaugeCard label="Habit Adherence" value={a.habitAdherence} color="var(--primary)" />
          </div>

          {/* Trends row */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Patient Outcome Trends" icon={Activity}>
              <LineChart
                labels={labels}
                yMax={100}
                series={[{ name: 'Wellness', color: 'var(--primary)', fill: true, data: a.outcomeTrend }]}
              />
            </Panel>
            <Panel title="Anxiety vs Depression Trends" icon={HeartPulse}>
              <LineChart
                labels={labels}
                yMax={100}
                unit="%"
                series={[
                  { name: 'Anxiety', color: 'var(--accent)', data: a.anxietyTrend },
                  { name: 'Depression', color: 'var(--primary)', data: a.depressionTrend },
                ]}
              />
            </Panel>
          </div>

          {/* Distributions row */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Risk Distribution" icon={ShieldAlert}>
              <DonutChart data={riskDonut} centerValue={patients.length} centerLabel="patients" />
            </Panel>
            <Panel title="Emotion Distribution" icon={Brain}>
              {emotionDonut.length > 0 ? (
                <DonutChart data={emotionDonut} centerValue={`${a.patientsWithData}`} centerLabel="with data" />
              ) : (
                <EmptyState icon={Brain} title="No emotion data" />
              )}
            </Panel>
          </div>

          {/* Engagement row */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Most Common Focus Topics" icon={ListChecks}>
              <BarChart data={a.topics} accent="var(--primary)" />
            </Panel>
            <Panel title="Engagement & Adherence" icon={TrendingUp}>
              <BarChart
                data={[
                  { label: 'Wellness plan adherence', value: a.planAdherence, color: 'var(--accent)' },
                  { label: 'CBT completion', value: a.cbtCompletion, color: 'var(--success)' },
                  { label: 'Journaling engagement', value: a.journalEngagement, color: 'var(--warning)' },
                  { label: 'Habit adherence', value: a.habitAdherence, color: 'var(--primary)' },
                ]}
                unit="%"
              />
            </Panel>
          </div>

          <p className="text-center text-[11px] text-faint">
            Analytics aggregate only patients who have shared data with you, derived from
            access-controlled mood, wellness, and engagement signals. Trends shown for the{' '}
            <span className="text-muted">{period}</span> window.
          </p>
        </div>
      )}
    </DoctorLayout>
  )
}

function GaugeCard({ label, value, color }) {
  return (
    <div className="card flex items-center justify-center rounded-2xl p-4 bg-surface border-border shadow-sm">
      <RadialGauge value={value} color={color} label={label} size={116} />
    </div>
  )
}
