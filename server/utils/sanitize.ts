/**
 * HTML sanitizer for post descriptions: DOMPurify (real parser — regex can be
 * bypassed with malformed tags). Output is PLAIN TEXT, never rendered as HTML
 * (CLAUDE.md Hard-Won Rule #14): block/line tags → line breaks, rest stripped.
 * Anchors get http(s)-only href + rel hardening.
 */
import DOMPurify from 'isomorphic-dompurify'

const ALLOWED_TAGS = [
  'a', 'b', 'i', 'em', 'strong', 'br', 'p', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr',
]

const ALLOWED_ATTR = ['href']

export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return ''
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  })
  return htmlToText(clean)
}

/** Sanitized HTML → readable plain text: line breaks preserved, tags stripped, entities decoded. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|ul|ol)>/gi, '\n')
    .replace(/<\/?(tr|td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
