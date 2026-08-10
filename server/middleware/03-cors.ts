/**
 * CORS middleware — allows cross-origin from SITE_URL + browser extensions (B-P1-5: Chromium extension calls API).
 */

export default defineEventHandler(async (event) => {
  const origin = getRequestHeader(event, 'origin')
  const siteUrl = await getSiteUrl() || ''

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

  // Handle preflight — end the response explicitly so Nitro doesn't fall through
  // to route matching (404 for POST routes without an OPTIONS handler).
  if (getMethod(event) === 'OPTIONS') {
    event.node.res.statusCode = 204
    event.node.res.end()
    return
  }
})
