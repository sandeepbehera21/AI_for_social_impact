import { useState } from 'react'
import { Activity, ShieldAlert } from 'lucide-react'
import { EMOTIONS, EMOTION_META, RISK_META } from '../lib/moodHistory.js'

/**
 * Mood-trends visualization shared by the patient dashboard (full) and the
 * doctor dashboard (compact). Takes the normalised summary shape produced by
 * `aggregateMood` / `normalizeServerSummary`:
 *   { totalSamples, latest, periods: { daily, weekly, monthly } }
 */
const PERIOD_LABELS = { daily: 'Today', weekly: 'This Week', monthly: 'This Month' }

function RiskBadge({ level }) {
  const meta = RISK_META[level] || RISK_META.low
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
    >
      <ShieldAlert className="h-3.5 w-3.5" /> {meta.label} risk
    </span>
  )
}

function DistributionBars({ distribution }) {
  return (
    <div className="space-y-2">
      {EMOTIONS.map((e) => {
        const pct = Math.round((distribution[e] || 0) * 100)
        return (
          <div key={e}>
            <div className="mb-0.5 flex justify-between text-xs text-muted">
              <span>
                {EMOTION_META[e].emoji} {e}
              </span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: EMOTION_META[e].color }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function MoodTrends({ summary, compact = false, defaultPeriod = 'weekly' }) {
  const [period, setPeriod] = useState(defaultPeriod)

  if (!summary || summary.totalSamples === 0) {
    return (
      <p className="text-sm text-muted">
        No mood data yet. Turn on the camera during a chat to start tracking your
        emotional trends.
      </p>
    )
  }

  const p = summary.periods[period] || summary.periods.weekly
  const dominant = p.dominant || 'Neutral'

  return (
    <div>
      {/* Period switcher */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-surface-2 p-1">
        {Object.keys(PERIOD_LABELS).map((key) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              period === key
                ? 'bg-primary text-primary-fg'
                : 'text-muted hover:text-fg'
            }`}
          >
            {PERIOD_LABELS[key]}
          </button>
        ))}
      </div>

      {p.samples === 0 ? (
        <p className="text-sm text-muted">No samples in this period.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{EMOTION_META[dominant].emoji}</span>
              <div>
                <div className="text-xs text-faint">Dominant mood</div>
                <div className="font-semibold" style={{ color: EMOTION_META[dominant].color }}>
                  {dominant}
                </div>
              </div>
            </div>
            <RiskBadge level={p.riskLevel} />
            <span className="inline-flex items-center gap-1 text-xs text-faint">
              <Activity className="h-3.5 w-3.5" /> {p.samples} samples ·{' '}
              {Math.round(p.avgConfidence * 100)}% avg confidence
            </span>
          </div>

          {!compact && <DistributionBars distribution={p.distribution} />}
          {compact && (
            <div className="flex gap-1.5">
              {EMOTIONS.map((e) => {
                const pct = Math.round((p.distribution[e] || 0) * 100)
                return (
                  <div
                    key={e}
                    title={`${e} ${pct}%`}
                    className="h-2 flex-1 rounded-full"
                    style={{
                      backgroundColor: EMOTION_META[e].color,
                      opacity: 0.25 + 0.75 * (p.distribution[e] || 0),
                    }}
                  />
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export { RiskBadge }
