import { getHeader, setHeader } from 'h3'
import { definePublicHandler } from '../../../platform/http/auth'
import { getIsAdmin } from '../../../utils/auth'

export default definePublicHandler({
  doc: { method: 'get', path: '/api/auth/status', summary: 'Login state probe (no-store)' },
  handler: async ({ event }) => {
    // auth/status is the canonical login-state probe — MUST NOT be CDN-cached
    // (a cached {is_admin:false} masks a freshly-logged-in admin). Belt-and-
    // suspenders with 02-cache-control.ts, so it survives middleware reordering.
    setHeader(event, 'Cache-Control', 'private, no-store')
    const cookie = getHeader(event, 'cookie') || ''
    const isAdmin = await getIsAdmin(cookie)
    return { is_admin: isAdmin }
  },
})
