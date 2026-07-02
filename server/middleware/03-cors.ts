/**
 * CORS middleware — allows cross-origin requests from SITE_URL and browser extensions.
 * B-P1-5: Required for Chromium extension to call API.
 */

export default defineEventHandler(async (event) => {
  const origin = getRequestHeader(event, 'origin')
  const siteUrl = process.env.SITE_URL || ''

  const allowed = origin && (
    origin === siteUrl ||
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://')
  )

  if (allowed) {
    setResponseHeaders(event, {
      'Access-Control-Allow-Origin': origin!,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Cookie',
    })
  }

  // Handle preflight
  if (getMethod(event) === 'OPTIONS') {
    setResponseStatus(event, 204)
    return
  }
})
