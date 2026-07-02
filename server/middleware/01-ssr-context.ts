// fetchAuthStatus, fetchPublicSettings NOT available in Nitro server — use in-process calls instead

let settingsCache: { data: any; etag: string | null; at: number } = { data: null, etag: null, at: 0 }
const SETTINGS_REVALIDATE_MS = 10_000

export default defineEventHandler(async (event) => {
  const path = event.path || ''

  // Skip API/bot/image proxy paths
  if (path.startsWith('/api/') || path.startsWith('/bot/') || path.startsWith('/i/')) return

  // Forward browser cookie for SSR auth resolution
  const cookieHeader = getHeader(event, 'cookie') || ''

  // Use native auth (direct DB/Redis, no HTTP hop)
  let isAdmin = false
  try {
    isAdmin = await getIsAdmin(cookieHeader)
  } catch {
    // Auth service down — default to non-admin
  }

  event.context.isAdmin = isAdmin
  event.context.ssrCookie = cookieHeader

  // Fetch public settings (in-process cache with back-off)
  const now = Date.now()
  if (now - settingsCache.at > SETTINGS_REVALIDATE_MS) {
    try {
      const data = await getPublicSettings()
      settingsCache = { data, etag: null, at: now }
    } catch {
      // Backend failure: keep stale data, back off for full TTL
      settingsCache = { data: settingsCache.data, etag: settingsCache.etag, at: now }
    }
  }
  event.context.siteSettings = settingsCache.data

  // Maintenance mode redirect (non-admin → /maintenance)
  const settings = event.context.siteSettings
  const maintenanceMode = (settings?.maintenance_mode || 'false').toLowerCase() === 'true'
  if (maintenanceMode && !isAdmin) {
    const isExempt =
      path === '/maintenance' || path === '/login' || path === '/logout' ||
      path.startsWith('/api/') || path.startsWith('/_nuxt/') ||
      path.startsWith('/favicon') || path.startsWith('/logo') || path.startsWith('/placeholder')
    if (!isExempt) {
      return new Response(null, {
        status: 302,
        headers: { Location: '/maintenance', 'Cache-Control': 'private, no-store' },
      })
    }
  }
})
