/**
 * HTML sanitizer for post descriptions.
 * Uses DOMPurify (via isomorphic-dompurify) so we get a real HTML parser instead
 * of regex — regex can be bypassed with malformed tags.
 *
 * Allowed: basic text formatting, headings, lists, code, blockquote, links.
 * Anchors get http(s)-only href + rel hardening.
 *
 * Output is PLAIN TEXT (never rendered as HTML anywhere in the frontend — see
 * AGENTS.md "external descriptions are rendered as plain text, never v-html"):
 * block/line tags are converted to line breaks, remaining tags stripped, and
 * HTML entities decoded. e.g. Pixiv captions with `<br>` / `<a href>` become
 * readable multi-line text instead of leaking literal markup.
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
