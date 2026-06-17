/**
 * Sanitize user input by stripping HTML tags and potential XSS vectors.
 * Extremely lightweight and safe for text areas.
 *
 * @param {string} input - The raw input string.
 * @returns {string} The sanitized input string.
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return ''
  // Strip HTML tags using regex
  return input
    .replace(/<[^>]*>/g, '') // remove HTML tags
    .replace(/javascript:/gi, '') // remove javascript: URI scheme
    .trim()
}
