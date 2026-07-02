import type { SiteSettings } from '~/types'

export function useSsrContext() {
  const ssrCookie = useState<string>('ssrCookie', () => '')
  const isAdmin = useState<boolean>('isAdmin', () => false)
  const siteSettings = useState<SiteSettings | null>('siteSettings', () => null)

  return { ssrCookie, isAdmin, siteSettings }
}
