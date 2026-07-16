export default defineEventHandler(async (event) => {
  // auth/status is the canonical login-state probe the client polls after
  // login/logout. It MUST NOT be CDN-cached — a cached {is_admin:false}
  // served to a freshly-logged-in admin makes the UI think they're still
  // logged out. Belt-and-suspenders with 02-cache-control.ts (which also
  // no-stores /api/auth/*); setting it here survives even if the middleware
  // ordering changes.
  setHeader(event, 'Cache-Control', 'private, no-store')
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  return { is_admin: isAdmin }
})
