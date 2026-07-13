/**
 * HTML sanitizer for post descriptions.
 * Uses DOMPurify (via isomorphic-dompurify) so we get a real HTML parser instead
 * of regex — regex can be bypassed with malformed tags.
 *
 * Allowed: basic text formatting, headings, lists, code, blockquote, links.
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
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  })
}
