export default defineEventHandler((event) => {
  if (event.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  // ponytail: this route previously did a $fetch self-call to /auth/logout to clear the
  // session there, but that route only called deleteCookie with path-only opts (which
  // would silently fail in non-prod because Secure mismatches). The cookie IS the
  // session — clear it directly and redirect.
  clearSessionCookie(event)
  return sendRedirect(event, '/', 302)
})
