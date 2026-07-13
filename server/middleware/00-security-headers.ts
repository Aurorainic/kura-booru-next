// S9: Security response headers. Set on every response that reaches a
// browser, including SSR HTML. SSE endpoints set their own Cache-Control
// which this middleware does not touch (we only add the security trio).
// ponytail: Permissions-Policy is kept minimal — if a feature needs to be
// enabled (camera/geolocation etc.), add it here on a per-route basis.
export default defineEventHandler((event) => {
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'X-Frame-Options', 'SAMEORIGIN')
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setResponseHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
})
