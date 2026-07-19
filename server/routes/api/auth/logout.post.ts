import { defineAdminHandler } from '../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/auth/logout', summary: 'Logout (server-side redirect)' },
  handler: async ({ event }) => {
    deleteCookie(event, 'kura_admin_session', { path: '/' })
    return { ok: true }
  },
})
