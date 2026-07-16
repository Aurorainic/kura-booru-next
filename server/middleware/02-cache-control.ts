export default defineEventHandler(async (event) => {
  const response = event.node.res
  if (!response) return

  const path = event.path || ''

  // API responses
  if (path.startsWith('/api/')) {
    // Don't override if handler already set Cache-Control (SSE, etc.)
    if (response.getHeader('Cache-Control')) return

    // v0.7.8: auth endpoints are login-state probes — NEVER CDN-cache.
    // A cached {is_admin:false} served to a just-logged-in admin makes the
    // client think it's still logged out. /api/auth/* must always be
    // private, no-store so the response reflects the caller's real session.
    if (path.startsWith('/api/auth/')) {
      response.setHeader('Cache-Control', 'private, no-store')
      response.setHeader('Vary', 'Cookie')
      return
    }

    // /api/admin/** is admin-only data (dashboard, extension keys, full
    // settings incl. secrets). 401 for anon, private body for admin — never
    // cache either outcome. Vary: Cookie so the two responses don't share
    // a CDN key.
    if (path.startsWith('/api/admin/')) {
      response.setHeader('Cache-Control', 'private, no-store')
      response.setHeader('Vary', 'Cookie')
      return
    }

    // Check admin status. On auth failure, fail-CLOSED for cache: skip CDN
    // caching entirely (s-maxage=0) instead of treating the visitor as admin
    // — over-private would silently bypass CDN and hammer the origin during
    // a Redis outage, but a wrong-content-cache leak is worse.
    const cookie = getRequestHeader(event, 'cookie') || ''
    let isAdmin = false
    let authOk = true
    try { isAdmin = await getIsAdmin(cookie) } catch {
      authOk = false
    }

    if (isAdmin) {
      // Admin sees non-safe posts / private data on the same paths anon does.
      // Vary: Cookie so the CDN keys the anon (cached) and admin (no-store)
      // responses separately — otherwise an admin response could poison the
      // anon cache entry or vice versa.
      response.setHeader('Cache-Control', 'private, no-store')
      response.setHeader('Vary', 'Cookie')
    } else if (!authOk) {
      response.setHeader('Cache-Control', 'no-store')
    } else if (path === '/api/posts/random') {
      // ponytail: random is session-independent (always a safe post) but
      // changes every request — short TTL so the CDN doesn't pin one post.
      response.setHeader('Cache-Control', 'public, s-maxage=10')
    } else {
      // Anon, session-independent (safe-only) data. Vary: Cookie anyway so a
      // subsequent admin request on the same path doesn't get served this
      // anon-cached body.
      response.setHeader('Cache-Control', 'public, s-maxage=60')
      response.setHeader('Vary', 'Cookie')
    }
    return
  }

  // SSR HTML — anon visitors get s-maxage 300 (mirrors nuxt.config.ts routeRules
  // swr: 300 for /, /posts/**, /tags/**, /search). Admin visitors (cookie session)
  // get private, no-store. /admin/**, /login, /logout get no-store by routeRule
  // already, so this branch mainly covers the home / and detail pages.
  // ponytail: if getIsAdmin Redis fail-CLOSED (authOk=false) during SSR, fall
  // back to no-store rather than risk leaking admin HTML into the public cache.
  //
  // CLAUDE.md pitfall: never cache SSR HTML without `Vary: Cookie`. Admin
  // HTML (e.g. /posts/[id] with PostSeriesNav admin delete buttons) must not
  // leak to anon through a cookieless CDN cache key. We set Vary on every SSR
  // HTML response so the CDN keys the cache by cookie presence.
  if (!path.startsWith('/_nuxt/') && !path.startsWith('/i/')) {
    response.setHeader('Vary', 'Cookie')
    // Authenticated paths — never cache.
    if (path.startsWith('/admin') || path === '/login' || path === '/logout') {
      response.setHeader('Cache-Control', 'private, no-store')
      return
    }
    const cookie = getRequestHeader(event, 'cookie') || ''
    let isAdmin = false
    let authOk = true
    try { isAdmin = await getIsAdmin(cookie) } catch {
      authOk = false
    }
    if (isAdmin || !authOk) {
      response.setHeader('Cache-Control', 'private, no-store')
    } else {
      response.setHeader('Cache-Control', 'public, s-maxage=300')
    }
  }
})
