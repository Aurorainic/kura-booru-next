/**
 * Simple HTML sanitizer for post descriptions.
 * ponytail: whitelist approach — strip everything except allowed tags/attrs.
 * Sufficient for admin-authored descriptions; no need for full bleach/sanitize-html dep.
 */

const ALLOWED_TAGS = new Set([
  'a', 'b', 'i', 'em', 'strong', 'br', 'p', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr',
])

const VOID_TAGS = new Set(['br', 'hr'])

export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return ''

  // Strip dangerous tags and attributes
  let result = html
    // Remove script/style/iframe/object/embed entirely
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|select|textarea|link|meta|base)[^>]*>/gi, '')
    // Remove event handlers (onclick, onload, etc.)
    .replace(/\s+on\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')
    // Remove javascript: URLs
    .replace(/href\s*=\s*['"]\s*javascript:/gi, 'href="#"')
    .replace(/src\s*=\s*['"]\s*javascript:/gi, 'src="#"')
    // Add target="_blank" rel="noopener" to all links
    .replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ')

  return result
}
