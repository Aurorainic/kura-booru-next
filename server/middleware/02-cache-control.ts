export default defineEventHandler(async (event) => {
  const response = event.node.res
  if (!response) return

  const path = event.path || ''

  // API responses
  if (path.startsWith('/api/')) {
    // Don't override if handler already set Cache-Control (SSE, etc.)
    if (response.getHeader('Cache-Control')) return

    // v0.7.8: auth endpoints are login-state probes — NEVER CDN-cache.
    // Cached {is_admin:false} would mask a just-logged-in admin.
    if (path.startsWith('/api/auth/')) {
      response.setHeader('Cache-Control', 'private, no-store')
      response.setHeader('Vary', 'Cookie')
      return
    }

    // /api/admin/** is admin-only data (dashboard, extension keys, secrets) — never cache either outcome; Vary: Cookie.
    if (path.startsWith('/api/admin/')) {
      response.setHeader('Cache-Control', 'private, no-store')
      response.setHeader('Vary', 'Cookie')
      return
    }

    // H14: 01-ssr-context precomputes isAdmin into event.context — reuse it, else compute here.
    // On auth failure fail-CLOSED: no-store (s-maxage=0) — a wrong-content cache leak is worse than origin hammering.
    const ctxIsAdmin = (event.context as { isAdmin?: boolean }).isAdmin
    let isAdmin = ctxIsAdmin === true
    let authOk = true
    if (ctxIsAdmin === undefined) {
      const cookie = getRequestHeader(event, 'cookie') || ''
      try { isAdmin = await getIsAdmin(cookie) } catch {
        authOk = false
      }
    }

    if (isAdmin) {
    // Admin sees non-safe/private data on the same paths anon does — Vary: Cookie
    // keys anon (cached) and admin (no-store) responses separately.
      response.setHeader('Cache-Control', 'private, no-store')
      response.setHeader('Vary', 'Cookie')
    } else if (!authOk) {
      response.setHeader('Cache-Control', 'no-store')
    } else if (path === '/api/posts/random') {
      response.setHeader('Cache-Control', 'public, s-maxage=10')
    } else {
      // Anon, session-independent data; Vary: Cookie so a later admin request isn't served this cached body.
      response.setHeader('Cache-Control', 'public, s-maxage=60')
      response.setHeader('Vary', 'Cookie')
    }
    return
  }

  // SSR HTML: anon gets s-maxage 300 (mirrors nuxt routeRules swr:300); admin gets private, no-store.
  // CLAUDE.md pitfall: never cache SSR HTML without Vary: Cookie — admin HTML must not leak to anon.
  if (!path.startsWith('/_nuxt/') && !path.startsWith('/i/')) {
    response.setHeader('Vary', 'Cookie')
    // Authenticated paths — never cache.
    if (path.startsWith('/admin') || path === '/login' || path === '/logout') {
      response.setHeader('Cache-Control', 'private, no-store')
      return
    }
    // H15: responses with Set-Cookie (login etc.) must never enter the CDN cache —
    // the CDN would serve them to other visitors; degrade to private, no-store.
    if (response.getHeader('set-cookie')) {
      response.setHeader('Cache-Control', 'private, no-store')
      return
    }
    // Reuse isAdmin from 01-ssr-context (avoids a duplicate getIsAdmin Redis call);
    // fall back to getIsAdmin to detect fail-closed auth.
    const ctxIsAdmin = (event.context as { isAdmin?: boolean }).isAdmin
    let isAdmin = ctxIsAdmin === true
    let authOk = true
    if (ctxIsAdmin === undefined) {
      try {
        isAdmin = await getIsAdmin(getRequestHeader(event, 'cookie') || '')
      } catch {
        authOk = false
      }
    }
    if (isAdmin || !authOk) {
      response.setHeader('Cache-Control', 'private, no-store')
    } else {
      response.setHeader('Cache-Control', 'public, s-maxage=300')
    }
  }
})
