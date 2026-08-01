import type { SiteSettings } from '~/types'

export function useSsrContext() {
  // Initialize from server-side event context on first SSR render, then rely
  // on useState serialization for hydration. This ensures the values set in
  // server/middleware/01-ssr-context.ts (isAdmin, ssrCookie, siteSettings)
  // are properly captured and transferred to the client, instead of being
  // re-initialized to defaults on every composable call. (M9 fix)
  if (import.meta.server) {
    const event = useRequestEvent()
    if (event?.context) {
      const ctx = event.context as {
        isAdmin?: boolean
        ssrCookie?: string
        siteSettings?: SiteSettings | null
        intranetMode?: boolean
      }
      // Only set from server context if it has been populated by middleware
      if (ctx.isAdmin !== undefined || ctx.ssrCookie !== undefined) {
        useState<string>('ssrCookie', () => ctx.ssrCookie || '')
        useState<boolean>('isAdmin', () => !!ctx.isAdmin)
        useState<SiteSettings | null>('siteSettings', () => ctx.siteSettings || null)
        useState<boolean>('intranetMode', () => !!ctx.intranetMode)
      }
    }
  }

  const ssrCookie = useState<string>('ssrCookie', () => '')
  const isAdmin = useState<boolean>('isAdmin', () => false)
  const siteSettings = useState<SiteSettings | null>('siteSettings', () => null)
  const intranetMode = useState<boolean>('intranetMode', () => false)

  return { ssrCookie, isAdmin, siteSettings, intranetMode }
}
