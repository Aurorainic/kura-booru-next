/**
 * CORS middleware — allows cross-origin requests from SITE_URL and browser extensions.
 * B-P1-5: Required for Chromium extension to call API.
 */

export default defineEventHandler(async (event) => {
  const origin = getRequestHeader(event, 'origin')
  const siteUrl = process.env.SITE_URL || ''

  // ponytail: extension origins allowed without credentials — they use X-Api-Key.
  // Only the site origin gets Allow-Credentials (cookie auth).
  // S10: env-controlled allowlist for specific extension IDs. Additionally
  // allow any chrome-extension:// and moz-extension:// origin prefix because
  // extension API keys (kb_ext_*) are per-admin and capability-scoped — the
  // key itself is the auth boundary, not the extension origin. This matches
  // the v0.7.8 extension auth model where any user can install the extension
  // and authenticate with their own key.
  const extOriginSet = new Set(
    (process.env.ALLOWED_EXT_ORIGINS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )

  const isSiteOrigin = origin === siteUrl
  const isExtOrigin = origin
    ? (extOriginSet.has(origin)
       || /^chrome-extension:\/\/[a-z0-9]+$/i.test(origin)
       || /^moz-extension:\/\/[a-z0-9-]+$/i.test(origin))
    : false

  if (isSiteOrigin || isExtOrigin) {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': origin!,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Cookie',
    }
    // Only the site origin gets Allow-Credentials — extensions authenticate via X-Api-Key.
    if (isSiteOrigin) headers['Access-Control-Allow-Credentials'] = 'true'
    setResponseHeaders(event, headers)
  }

  // Handle preflight — end the response explicitly so Nitro doesn't fall
  // through to route matching (which returns 404 for POST routes that have
  // no OPTIONS handler).
  if (getMethod(event) === 'OPTIONS') {
    event.node.res.statusCode = 204
    event.node.res.end()
    return
  }
})
