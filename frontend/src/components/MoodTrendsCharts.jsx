import { useState, useMemo } from 'react'
import { Calendar, TrendingUp, ShieldAlert, Award } from 'lucide-react'
import { EMOTIONS, EMOTION_META, RISK_META } from '../lib/moodHistory.js'

/**
 * A premium, dependency-free SVG Charting Component for MindEase.
 * Processes raw mood entries and visualizes:
 * 1. An Area Chart of the Emotional Risk Score over time.
 * 2. A Stacked or Multi-Line trend chart of individual emotions.
 * 3. Daily, Weekly, and Monthly aggregations with interactive tooltips.
 */
export default function MoodTrendsCharts({ entries }) {
  const [range, setRange] = useState('weekly') // 'weekly' (7 days) | 'monthly' (30 days)
  const [hoveredPoint, setHoveredPoint] = useState(null)

  // 1. Group and sort entries by day
  const dailyData = useMemo(() => {
    if (!entries || entries.length === 0) return []

    // Group entries by date string (local timezone)
    const groups = {}
    entries.forEach((e) => {
      const dateStr = new Date(e.ts).toISOString().split('T')[0]
      if (!groups[dateStr]) {
        groups[dateStr] = []
      }
      groups[dateStr].push(e)
    })

    // Calculate daily statistics
    const days = Object.keys(groups).map((dateStr) => {
      const dayEntries = groups[dateStr]
      const counts = {}
      EMOTIONS.forEach((emo) => { counts[emo] = 0 })
      let confSum = 0

      dayEntries.forEach((e) => {
        if (EMOTIONS.includes(e.dominantEmotion)) {
          counts[e.dominantEmotion]++
        }
        confSum += e.confidence || 0
      })

      const n = dayEntries.length || 1
      const distribution = {}
      EMOTIONS.forEach((emo) => {
        distribution[emo] = counts[emo] / n
      })

      // Risk score: Sad * 1.0 + Fear * 1.0 + Angry * 0.5
      const riskScore = Math.min(
        1,
        (distribution['Sad'] || 0) * 1.0 +
        (distribution['Fear'] || 0) * 1.0 +
        (distribution['Angry'] || 0) * 0.5
      )

      const dominant = EMOTIONS.reduce((a, b) => (counts[b] > counts[a] ? b : a), EMOTIONS[0])

      return {
        dateStr,
        label: new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        samples: n,
        dominant,
        distribution,
        avgConfidence: confSum / n,
        riskScore,
      }
    })

    // Sort chronologically
    return days.sort((a, b) => a.dateStr.localeCompare(b.dateStr))
  }, [entries])

  // Filter based on range selection
  const chartData = useMemo(() => {
    const limit = range === 'weekly' ? 7 : 30
    return dailyData.slice(-limit)
  }, [dailyData, range])

  if (chartData.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-border bg-surface-2 p-6 text-center">
        <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <TrendingUp className="h-6 w-6" />
        </span>
        <p className="text-sm text-muted">
          No mood history available yet. Keep chatting with the camera on to populate your trends.
        </p>
      </div>
    )
  }

  // Chart Dimensions
  const width = 600
  const height = 240
  const paddingLeft = 45
  const paddingRight = 20
  const paddingTop = 20
  const paddingBottom = 35

  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  // Math helper functions
  const getX = (index) => {
    if (chartData.length <= 1) return paddingLeft + chartWidth / 2
    return paddingLeft + (index * chartWidth) / (chartData.length - 1)
  }

  const getY = (val) => {
    // Clamped val in [0, 1]
    const clamped = Math.max(0, Math.min(1, val))
    return paddingTop + chartHeight - clamped * chartHeight
  }

  // Draw smooth Bezier curve line for Risk Score
  let riskLinePath = ''
  let riskAreaPath = ''

  if (chartData.length > 0) {
    riskLinePath = `M ${getX(0)} ${getY(chartData[0].riskScore)}`
    chartData.forEach((pt, idx) => {
      if (idx > 0) {
        // Linear path for simplicity and responsiveness
        riskLinePath += ` L ${getX(idx)} ${getY(pt.riskScore)}`
      }
    })

    // Close the area path for gradient fill
    riskAreaPath = `${riskLinePath} L ${getX(chartData.length - 1)} ${getY(0)} L ${getX(0)} ${getY(0)} Z`
  }

  // Risk Level Category Helper
  const getRiskLevel = (score) => {
    if (score >= 0.6) return 'high'
    if (score >= 0.4) return 'elevated'
    if (score >= 0.2) return 'moderate'
    return 'low'
  }

  return (
    <div className="space-y-6">
      {/* Header with Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-fg">Interactive Mood &amp; Stress Analytics</h3>
          <p className="text-xs text-muted">Tracking emotional risk index over time</p>
        </div>

        <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
          <button
            onClick={() => setRange('weekly')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              range === 'weekly' ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg'
            }`}
          >
            Last 7 Days
          </button>
          <button
            onClick={() => setRange('monthly')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              range === 'monthly' ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg'
            }`}
          >
            Last 30 Days
          </button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        {/* Main Chart Canvas */}
        <div className="card relative p-4 md:col-span-3">
          {/* SVG Canvas */}
          <div className="relative w-full overflow-hidden">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full overflow-visible"
              style={{ maxHeight: '240px' }}
              role="img"
              aria-label="Mood and stress risk area chart over time"
            >
              {/* Gradients */}
              <defs>
                <linearGradient id="riskAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.4" />
                  <stop offset="50%" stopColor="#f97316" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="riskLineGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="var(--accent)" />
                  <stop offset="50%" stopColor="#f97316" />
                  <stop offset="100%" stopColor="#ef4444" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1.0].map((level) => (
                <g key={level}>
                  <line
                    x1={paddingLeft}
                    y1={getY(level)}
                    x2={width - paddingRight}
                    y2={getY(level)}
                    stroke="var(--border)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={getY(level) + 3}
                    textAnchor="end"
                    className="fill-faint text-[9px] font-medium tabular-nums"
                  >
                    {Math.round(level * 100)}%
                  </text>
                </g>
              ))}

              {/* Area filled path */}
              {riskAreaPath && (
                <path
                  d={riskAreaPath}
                  fill="var(--accent)"
                  fillOpacity="0.08"
                  className="transition-all duration-300"
                />
              )}

              {/* Line path */}
              {riskLinePath && (
                <path
                  d={riskLinePath}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-all duration-300"
                />
              )}

              {/* Day markers (x-axis labels) */}
              {chartData.map((pt, idx) => {
                // Determine label density
                const skip = chartData.length > 10 ? (idx % 4 === 0 ? false : true) : false
                if (skip) return null

                return (
                  <text
                    key={pt.dateStr}
                    x={getX(idx)}
                    y={height - 10}
                    textAnchor="middle"
                    className="fill-muted text-[9px] font-medium"
                  >
                    {pt.label}
                  </text>
                )
              })}

              {/* Interactive Circles / Hover zones */}
              {chartData.map((pt, idx) => (
                <g key={pt.dateStr}>
                  {/* Invisible broad hover bar */}
                  <rect
                    x={getX(idx) - (chartWidth / (chartData.length - 1 || 1)) / 2}
                    y={0}
                    width={chartWidth / (chartData.length - 1 || 1)}
                    height={height - paddingBottom}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredPoint({ ...pt, idx })}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />

                  {/* Visual data point circle */}
                  <circle
                    cx={getX(idx)}
                    cy={getY(pt.riskScore)}
                    r={hoveredPoint?.dateStr === pt.dateStr ? 6 : 4}
                    fill={EMOTION_META[pt.dominant]?.color || 'var(--accent)'}
                    stroke="var(--surface)"
                    strokeWidth="1.5"
                    className="pointer-events-none transition-all duration-150"
                  />
                </g>
              ))}

              {/* Hover vertical line */}
              {hoveredPoint && (
                <line
                  x1={getX(hoveredPoint.idx)}
                  y1={topTextureHeight(hoveredPoint.riskScore)}
                  x2={getX(hoveredPoint.idx)}
                  y2={height - paddingBottom}
                  stroke="var(--border-strong)"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  className="pointer-events-none"
                />
              )}

              {/* Interactive Tooltip Card inside SVG using foreignObject */}
              {hoveredPoint && (
                <foreignObject
                  x={Math.min(width - 165, Math.max(15, getX(hoveredPoint.idx) - 75))}
                  y={Math.max(5, getY(hoveredPoint.riskScore) - 95)}
                  width="150"
                  height="90"
                  className="pointer-events-none"
                >
                  <div className="glass rounded-lg border border-border p-2 shadow-lg text-[10px] text-fg">
                    <div className="font-semibold text-faint">{hoveredPoint.label}</div>
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className="text-xs">{EMOTION_META[hoveredPoint.dominant]?.emoji}</span>
                      <span
                        className="font-bold"
                        style={{ color: EMOTION_META[hoveredPoint.dominant]?.color }}
                      >
                        {hoveredPoint.dominant}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5 text-muted">
                      <div className="flex justify-between">
                        <span>Risk:</span>
                        <span className="font-semibold text-fg">
                          {Math.round(hoveredPoint.riskScore * 100)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Confidence:</span>
                        <span className="font-semibold text-fg">
                          {Math.round(hoveredPoint.avgConfidence * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </foreignObject>
              )}
            </svg>
          </div>
        </div>

        {/* Side statistics summary card */}
        <div className="flex flex-col justify-between gap-4">
          <div className="glass flex-1 rounded-2xl p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
              <ShieldAlert className="h-4 w-4 text-red-400" /> Stress Summary
            </h4>
            {(() => {
              const totalSamples = chartData.reduce((acc, curr) => acc + curr.samples, 0)
              const avgRisk = chartData.reduce((acc, curr) => acc + curr.riskScore, 0) / chartData.length
              const latestRisk = chartData[chartData.length - 1].riskScore
              const level = getRiskLevel(latestRisk)

              return (
                <div className="space-y-4">
                  <div>
                    <div className="text-2xl font-bold text-fg tabular-nums">
                      {Math.round(avgRisk * 100)}%
                    </div>
                    <div className="text-[10px] text-muted">Average stress level in period</div>
                  </div>

                  <div>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: `${RISK_META[level]?.color || '#22c55e'}22`,
                        color: RISK_META[level]?.color || '#22c55e',
                      }}
                    >
                      {RISK_META[level]?.label || 'Low'} Risk
                    </span>
                    <div className="mt-1 text-[10px] text-muted">Latest session risk category</div>
                  </div>

                  <div className="border-t border-border pt-3">
                    <div className="flex justify-between text-xs text-muted">
                      <span>Total Data Points:</span>
                      <span className="font-semibold text-fg tabular-nums">{totalSamples}</span>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>

          <div className="glass rounded-2xl p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
              <Award className="h-4 w-4 text-emerald-400" /> Mood Stability
            </h4>
            {(() => {
              // Stability = 1 - standard deviation of dominant mood scores
              const riskScores = chartData.map((d) => d.riskScore)
              const mean = riskScores.reduce((a, b) => a + b, 0) / riskScores.length
              const variance = riskScores.reduce((a, b) => a + (b - mean) ** 2, 0) / riskScores.length
              const stdDev = Math.sqrt(variance)
              const stability = Math.max(0, 1 - stdDev)

              return (
                <div>
                  <div className="text-2xl font-bold text-emerald-400 tabular-nums">
                    {Math.round(stability * 100)}%
                  </div>
                  <div className="text-[10px] text-muted">
                    Mood stability factor based on variance of emotion swings.
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}

function topTextureHeight(riskScore) {
  // Chart paddingTop is 20, chart height is 240, grid height is 185
  const clamped = Math.max(0, Math.min(1, riskScore))
  return 20 + 185 - clamped * 185
}
