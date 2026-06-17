/**
 * StarRating — renders 1-5 stars.
 *
 * Props:
 *   value      number  — current rating (0-5, supports decimals for display)
 *   onChange   fn      — if provided, stars become interactive (click to rate)
 *   size       'sm'|'md'|'lg'
 *   showValue  bool    — show numeric value next to stars
 *   count      number  — review count to show in parentheses
 */
export default function StarRating({
  value = 0,
  onChange,
  size = 'md',
  showValue = false,
  count,
}) {
  const interactive = typeof onChange === 'function'
  const sizes = { sm: 'h-3.5 w-3.5', md: 'h-5 w-5', lg: 'h-6 w-6' }
  const iconSize = sizes[size] || sizes.md

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        // Full, half, or empty
        const filled = value >= star
        const half = !filled && value >= star - 0.5

        const Element = interactive ? 'button' : 'span'
        return (
          <Element
            key={star}
            type={interactive ? 'button' : undefined}
            onClick={() => interactive && onChange(star)}
            className={`transition-transform ${
              interactive
                ? 'cursor-pointer hover:scale-125 focus:outline-none'
                : 'cursor-default'
            }`}
            aria-label={interactive ? `Rate ${star} star${star > 1 ? 's' : ''}` : undefined}
          >
            {/* SVG star — gold when filled, half, or empty */}
            <svg
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
              className={iconSize}
            >
              <defs>
                <linearGradient id={`half-${star}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="50%" stopColor="#FBBF24" />
                  <stop offset="50%" stopColor="transparent" />
                </linearGradient>
              </defs>
              <path
                d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                fill={
                  filled
                    ? '#FBBF24'
                    : half
                    ? `url(#half-${star})`
                    : 'rgba(255,255,255,0.15)'
                }
              />
            </svg>
          </Element>
        )
      })}

      {showValue && value > 0 && (
        <span className="ml-1 text-sm font-semibold text-amber-300">
          {value.toFixed(1)}
        </span>
      )}

      {count !== undefined && (
        <span className="text-xs text-muted">
          ({count === 0 ? 'No reviews' : `${count} review${count > 1 ? 's' : ''}`})
        </span>
      )}
    </div>
  )
}
