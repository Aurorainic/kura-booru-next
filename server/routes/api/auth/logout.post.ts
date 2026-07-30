import { defineAdminHandler } from '../../../platform/http/auth'
import { clearSessionCookie } from '../../../utils/auth'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/auth/logout', summary: 'Logout (server-side redirect)' },
  handler: async ({ event }) => {
    clearSessionCookie(event)
    return { ok: true }
  },
})
