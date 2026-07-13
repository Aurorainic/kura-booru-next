/**
 * CORS middleware — allows cross-origin requests from SITE_URL and browser extensions.
 * B-P1-5: Required for Chromium extension to call API.
 */

export default defineEventHandler(async (event) => {
  const origin = getRequestHeader(event, 'origin')
  const siteUrl = process.env.SITE_URL || ''

  // ponytail: extension origins allowed without credentials — they use X-Api-Key.
  // Only the site origin gets Allow-Credentials (cookie auth).
  // S10: env-controlled allowlist replaces the `chrome-extension://*` /
  // `moz-extension://*` prefix wildcard. Comma-separated exact origins.
  const extOriginSet = new Set(
    (process.env.ALLOWED_EXT_ORIGINS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )

  const isSiteOrigin = origin === siteUrl
  const isExtOrigin = origin ? extOriginSet.has(origin) : false

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

  // Handle preflight
  if (getMethod(event) === 'OPTIONS') {
    setResponseStatus(event, 204)
    return
  }
})
