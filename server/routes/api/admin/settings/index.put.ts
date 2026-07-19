import { defineAdminHandler } from '../../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'put', path: '/api/admin/settings', summary: 'Update admin settings' },
  handler: async ({ event }) => {
    // TRUSTED-ADMIN: updateSettings writes any key the body provides. The gate
    // here is the admin session — there is no allowlist. If you ever need to
    // gate this from a public endpoint, add a SAFE_KEYS check before
    // updateSettings; do not relax the admin-only contract.
    const body = await readBody(event)
    await updateSettings(body.settings)
    return { ok: true }
  },
})
