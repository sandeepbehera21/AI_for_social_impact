/** Small coloured pill for an appointment's lifecycle status. */
const STYLES = {
  pending: 'border-warning/40 bg-warning-soft text-warning',
  approved: 'border-primary/40 bg-primary-soft text-primary',
  completed: 'border-border-strong bg-surface-2 text-muted',
  rejected: 'border-danger/40 bg-danger-soft text-danger',
  expired: 'border-danger/30 bg-danger-soft text-danger',
}

export default function StatusBadge({ status }) {
  const cls = STYLES[status] || STYLES.completed
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}
    >
      {status}
    </span>
  )
}
