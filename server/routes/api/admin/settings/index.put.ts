import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'

// Admin settings key allowlist. Only these keys can be written via the
// settings endpoint. Adding a new setting key requires an explicit entry here.
const ALLOWED_KEYS = new Set([
  'site_title',
  'site_description',
  'announcement',
  'head_inject',
  'maintenance_mode',
  'database_url',
  'redis_url',
])

export default defineAdminHandler({
  doc: { method: 'put', path: '/api/admin/settings', summary: 'Update admin settings' },
  handler: async ({ event }) => {
    const body = await readBody(event)
    const settings = body.settings as Record<string, string> | undefined

    if (!settings || typeof settings !== 'object') {
      throw new AppError('VALIDATION_FAILED', 400, 'settings object required')
    }

    // Filter out unlisted keys silently — admin is trusted but defense-in-depth
    // prevents accidental writes from future frontend changes.
    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(settings)) {
      if (ALLOWED_KEYS.has(key)) {
        filtered[key] = String(value)
      }
    }

    await updateSettings(filtered)
    return { ok: true }
  },
})
