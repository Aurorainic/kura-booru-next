/**
 * Simple HTML sanitizer for post descriptions.
 * ponytail: regex allowlist — strips tags/attrs not in the safe set.
 * Sufficient for external-site descriptions (Pixiv etc.); not a full parser.
 * If descriptions ever accept truly untrusted HTML, swap for DOMPurify.
 */

const ALLOWED_TAGS = new Set([
  'a', 'b', 'i', 'em', 'strong', 'br', 'p', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr',
])

const VOID_TAGS = new Set(['br', 'hr'])

export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return ''

  // 1. Escape everything first — we re-decode only the tags we allow.
  let s = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // 2. Re-enable allowed tags by un-escaping &lt;tag ...&gt; patterns.
  //    Matches &lt;tag&gt;, &lt;tag attr="..."&gt;, &lt;/tag&gt;
  s = s.replace(/&lt;(\/?)([a-zA-Z0-9]+)((?:[^&]|&(?!gt;))*?)&gt;/g, (m, slash, tag, rest) => {
    const lower = tag.toLowerCase()
    if (!ALLOWED_TAGS.has(lower)) return ''

    // For <a>, only allow href with http(s) — drop all other attrs.
    if (lower === 'a') {
      const hrefMatch = rest.match(/href\s*=\s*&quot;(https?:[^&]+)&quot;/i)
      const href = hrefMatch ? hrefMatch[1] : '#'
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">`
    }

    // For other allowed tags, strip all attributes (no style/class/src handlers).
    return `<${slash}${lower}>`
  })

  // 3. Close void tags that were opened but not self-closed.
  //    br/hr don't need closing; leave as-is.

  return s
}
