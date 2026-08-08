// fetchAuthStatus, fetchPublicSettings NOT available in Nitro server — use in-process calls instead
import { getPublicSettings } from '../utils/settings'
import { isAiEnabled } from '../lib/ai/config'

let settingsCache: { data: any; etag: string | null; at: number } = { data: null, etag: null, at: 0 }
const SETTINGS_REVALIDATE_MS = 10_000

export default defineEventHandler(async (event) => {
  const path = event.path || ''

  // H14: 即使是 /api/ 路径也先计算 isAdmin 写入 context — 02-cache-control
  // 中间件据此复用，避免每条 API 请求重复 getIsAdmin（30s adminCache 之外
  // 仍是 1 次 Redis round-trip / 请求）。
  const cookieHeader = getHeader(event, 'cookie') || ''
  let isAdmin = false
  try {
    isAdmin = await getIsAdmin(cookieHeader)
  } catch {
    // Auth service down — default to non-admin
  }
  event.context.isAdmin = isAdmin

  // Skip API/bot/image proxy paths (其余逻辑：维护模式重定向等仅限 SSR 页面)
  if (path.startsWith('/api/') || path.startsWith('/bot/') || path.startsWith('/i/')) return

  // Forward browser cookie for SSR auth resolution
  event.context.ssrCookie = cookieHeader

  // Fetch public settings (in-process cache with back-off)
  const now = Date.now()
  if (now - settingsCache.at > SETTINGS_REVALIDATE_MS) {
    try {
      const data = await getPublicSettings() as Record<string, string>
      // UI-only flags are injected into the SSR context, not the public API.
      data.ai_enabled = String(isAiEnabled())
      settingsCache = { data, etag: null, at: now }
    } catch {
      // Backend failure: keep stale data, back off for full TTL
      settingsCache = { data: settingsCache.data, etag: settingsCache.etag, at: now }
    }
  }
  event.context.siteSettings = settingsCache.data

  // Intranet mode: everyone is admin; short-circuit further checks.
  // run_mode 来自 DB settings（默认 public），后台切换即时生效。
  const { getRunMode } = await import('../utils/settings')
  const intranetMode = await getRunMode() === 'intranet'
  event.context.intranetMode = intranetMode
  if (intranetMode) {
    event.context.isAdmin = true
    // Inject the flag into settings so the client UI can hide login affordances.
    if (event.context.siteSettings) {
      event.context.siteSettings.intranet_mode = 'true'
    }
    return
  }

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

  // Maintenance off → bounce visitors off /maintenance back to home
  if (!maintenanceMode && path === '/maintenance') {
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Cache-Control': 'private, no-store' },
    })
  }
})
