/**
 * DoctorCharts — a small set of dependency-free SVG charts for the clinical
 * analytics surface. Matches the project's existing zero-dependency charting
 * approach (see MoodTrendsCharts.jsx) so we add no new libraries.
 *
 * All charts are responsive (viewBox + preserveAspectRatio), theme-aware
 * (inherit currentColor / explicit hex), and animate in with Framer Motion.
 */
import { useId, useState } from 'react'
import { motion } from 'framer-motion'

const AXIS = 'var(--border)'
const TEXT = 'var(--muted)'

function niceMax(v) {
  if (v <= 1) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

/* ------------------------------------------------------------------ */
/* Line / area chart — trends over time (one or more series).          */
/* ------------------------------------------------------------------ */
export function LineChart({ series = [], labels = [], height = 220, yMax, unit = '' }) {
  const gid = useId()
  const [hover, setHover] = useState(null)
  const W = 640
  const H = height
  const padL = 40
  const padR = 16
  const padT = 16
  const padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const allVals = series.flatMap((s) => s.data)
  const max = yMax || niceMax(Math.max(1, ...allVals))
  const n = labels.length || (series[0]?.data.length ?? 0)

  const x = (i) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v) => padT + innerH - (v / max) * innerH

  const gridY = [0, 0.25, 0.5, 0.75, 1].map((f) => padT + innerH - f * innerH)

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" preserveAspectRatio="xMidYMid meet">
        {gridY.map((gy, i) => (
          <line key={i} x1={padL} x2={W - padR} y1={gy} y2={gy} stroke={AXIS} strokeWidth="1" />
        ))}
        {[0, 0.5, 1].map((f, i) => (
          <text key={i} x={padL - 6} y={padT + innerH - f * innerH + 4} textAnchor="end" fontSize="10" fill={TEXT}>
            {Math.round(f * max)}
          </text>
        ))}
        {series.map((s, si) => {
          const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')
          const area = `${padL},${padT + innerH} ${pts} ${x(s.data.length - 1)},${padT + innerH}`
          return (
            <g key={si}>
              {s.fill && (
                <>
                  <defs>
                    <linearGradient id={`${gid}-grad-${si}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                      <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <motion.polygon
                    points={area}
                    fill={`url(#${gid}-grad-${si})`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.6 }}
                  />
                </>
              )}
              <motion.polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
              {s.data.map((v, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(v)}
                  r={hover?.i === i ? 4 : 2.5}
                  fill={s.color}
                  onMouseEnter={() => setHover({ i, si })}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: 'pointer' }}
                />
              ))}
            </g>
          )
        })}
        {/* X labels (thinned to avoid crowding) */}
        {labels.map((l, i) => {
          const every = Math.ceil(n / 8)
          if (i % every !== 0 && i !== n - 1) return null
          return (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={TEXT}>
              {l}
            </text>
          )
        })}
        {hover && (
          <g>
            <line x1={x(hover.i)} x2={x(hover.i)} y1={padT} y2={padT + innerH} stroke="var(--border-strong)" strokeDasharray="3 3" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="mt-1 text-center text-xs text-muted">
          <span className="text-faint">{labels[hover.i]}: </span>
          {series.map((s, si) => (
            <span key={si} className="ml-2" style={{ color: s.color }}>
              {s.name} {s.data[hover.i]}
              {unit}
            </span>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap justify-center gap-4">
          {series.map((s, si) => (
            <span key={si} className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Donut chart — distribution (risk tiers, emotions).                  */
/* ------------------------------------------------------------------ */
export function DonutChart({ data = [], size = 180, thickness = 26, centerLabel, centerValue }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r

  // Precompute each segment's dash length and cumulative offset up-front so the
  // render pass mutates nothing (keeps the component pure).
  const dashes = data.map((d) => (d.value / total) * circ)
  const segments = data.map((d, i) => ({
    ...d,
    dash: dashes[i],
    offset: dashes.slice(0, i).reduce((s, v) => s + v, 0),
  }))

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        {segments.map((d, i) => (
          <motion.circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={d.color}
            strokeWidth={thickness}
            strokeDasharray={`${d.dash} ${circ - d.dash}`}
            strokeDashoffset={-d.offset}
            strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cy})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.08 }}
          />
        ))}
        {(centerValue !== undefined || centerLabel) && (
          <>
            <text x={cx} y={cy - 2} textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--fg)">
              {centerValue}
            </text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize="11" fill={TEXT}>
              {centerLabel}
            </text>
          </>
        )}
      </svg>
      <div className="space-y-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: d.color }} />
            <span className="text-muted">{d.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-fg">{d.value}</span>
            <span className="text-xs text-faint">({Math.round((d.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bar chart — horizontal ranked bars (topics, adherence).             */
/* ------------------------------------------------------------------ */
export function BarChart({ data = [], unit = '', accent = '#00ffd5' }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="space-y-2.5">
      {data.length === 0 && <p className="text-sm text-faint">No data yet.</p>}
      {data.map((d, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted">{d.label}</span>
            <span className="font-semibold tabular-nums text-fg">
              {d.value}
              {unit}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full"
              style={{ background: d.color || accent }}
              initial={{ width: 0 }}
              animate={{ width: `${(d.value / max) * 100}%` }}
              transition={{ duration: 0.7, delay: i * 0.05, ease: 'easeOut' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sparkline — tiny inline trend for KPI cards / patient rows.         */
/* ------------------------------------------------------------------ */
export function Sparkline({ data = [], color = '#00ffd5', width = 96, height = 28 }) {
  if (!data.length) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1 || 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* RadialGauge — single 0–100 score (wellness, completion).            */
/* ------------------------------------------------------------------ */
export function RadialGauge({ value = 0, max = 100, size = 120, color = '#00ffd5', label }) {
  const r = (size - 16) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, value / max))
  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
        <motion.circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ}
          transform={`rotate(-90 ${cx} ${cy})`}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - frac) }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--fg)">
          {Math.round(value)}
        </text>
      </svg>
      {label && <span className="mt-1 text-xs text-muted">{label}</span>}
    </div>
  )
}
