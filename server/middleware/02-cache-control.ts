export default defineEventHandler(async (event) => {
  const response = event.node.res
  if (!response) return

  const path = event.path || ''

  // API responses
  if (path.startsWith('/api/')) {
    // Don't override if handler already set Cache-Control (SSE, etc.)
    if (response.getHeader('Cache-Control')) return

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
      response.setHeader('Cache-Control', 'private, no-store')
    } else if (!authOk) {
      response.setHeader('Cache-Control', 'no-store')
    } else if (path === '/api/posts/random') {
      response.setHeader('Cache-Control', 'public, s-maxage=10')
    } else {
      response.setHeader('Cache-Control', 'public, s-maxage=60')
    }
    return
  }

  // SSR HTML — anon visitors get s-maxage 300 (mirrors nuxt.config.ts routeRules
  // swr: 300 for /, /posts/**, /tags/**, /search). Admin visitors (cookie session)
  // get private, no-store. /admin/** paths get no-store by routeRule already,
  // so this branch mainly covers the home / and detail pages.
  // ponytail: if getIsAdmin Redis fail-CLOSED (authOk=false) during SSR, fall
  // back to no-store rather than risk leaking admin HTML into the public cache.
  if (!path.startsWith('/_nuxt/') && !path.startsWith('/i/')) {
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
