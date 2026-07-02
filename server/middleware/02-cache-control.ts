export default defineEventHandler(async (event) => {
  const response = event.node.res
  if (!response) return

  const path = event.path || ''

  // API responses
  if (path.startsWith('/api/')) {
    // Don't override if handler already set Cache-Control (SSE, etc.)
    if (response.getHeader('Cache-Control')) return

    // Check admin status
    const cookie = getRequestHeader(event, 'cookie') || ''
    let isAdmin = false
    try { isAdmin = await getIsAdmin(cookie) } catch {
      // Fail-closed for caching: treat as admin to use private/no-store
      // (better to over-cache privately than leak admin content publicly)
      isAdmin = true
    }

    if (isAdmin) {
      response.setHeader('Cache-Control', 'private, no-store')
    } else if (path === '/api/posts/random') {
      response.setHeader('Cache-Control', 'public, s-maxage=10')
    } else {
      response.setHeader('Cache-Control', 'public, s-maxage=60')
    }
    return
  }

  // SSR HTML — never cache at CDN (admin content leak prevention)
  if (!path.startsWith('/_nuxt/') && !path.startsWith('/i/')) {
    response.setHeader('Cache-Control', 'private, no-store')
  }
})
