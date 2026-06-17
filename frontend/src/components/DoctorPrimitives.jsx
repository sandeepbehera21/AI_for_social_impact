/**
 * Small shared primitives for the Doctor portal: KPI stat cards, risk pills,
 * and section wrappers. Kept together so the clinical visual language (spacing,
 * surfaces, accent treatment) stays consistent across all four pages.
 */
import { motion } from 'framer-motion'
import { RISK_TIERS } from '../lib/doctorData.js'
import { Sparkline } from './DoctorCharts.jsx'

/* KPI card — headline metric with icon, optional delta + sparkline. */
export function KpiCard({ icon: Icon, label, value, accent = 'var(--primary)', sub, spark, delay = 0, onClick }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onClick={onClick}
      className={`card relative overflow-hidden p-5 ${
        onClick ? 'cursor-pointer transition hover:border-border-strong hover:shadow-md' : ''
      }`}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-15 blur-2xl"
        style={{ background: accent }}
      />
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
        >
          {Icon && <Icon className="h-5 w-5" />}
        </div>
        {spark && <Sparkline data={spark} color={accent} />}
      </div>
      <div className="mt-4 text-3xl font-bold tabular-nums text-fg">{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
      {sub && <div className="mt-2 text-xs text-faint">{sub}</div>}
    </motion.div>
  )
}

/* Risk pill — colored tier badge (🔴 High / 🟠 Medium / 🟢 Low). */
export function RiskPill({ tier, score, size = 'md' }) {
  const meta = RISK_TIERS[tier] || RISK_TIERS.low
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${pad}`}
      style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: meta.color, boxShadow: `0 0 8px ${meta.glow}` }}
      />
      {meta.label}
      {score !== undefined && <span className="opacity-70">· {score}</span>}
    </span>
  )
}

/* Section card wrapper with a titled header. */
export function Panel({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
            {Icon && <Icon className="h-[18px] w-[18px] text-primary" />}
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/* Empty-state placeholder used inside panels. */
export function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
      {Icon && <Icon className="mb-3 h-7 w-7 text-faint" />}
      <p className="text-sm font-medium text-muted">{title}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  )
}
