import { defineAdminHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { updateSettings } from '../../../utils/settings'
import { SETTING_DEF_MAP } from '../../../utils/settings-defs'

const WRITABLE_KEYS = new Set(
  Object.values(SETTING_DEF_MAP)
    .filter(d => d.type !== 'readonly')
    .map(d => d.key),
)

export default defineAdminHandler({
  doc: { method: 'put', path: '/api/settings', summary: 'Update settings (admin, hot reload)' },
  handler: async ({ event }) => {
    const body = await readBody<{ settings: Record<string, string> }>(event)
    if (!body?.settings) throw new AppError('VALIDATION_FAILED', 400, 'settings object required')

    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(body.settings)) {
      if (WRITABLE_KEYS.has(key)) filtered[key] = String(value)
    }
    if (Object.keys(filtered).length === 0) {
      throw new AppError('VALIDATION_FAILED', 400, 'no writable settings provided')
    }

    await updateSettings(filtered)
    const { getAdminSettings } = await import('../../../utils/settings')
    return { settings: await getAdminSettings() }
  },
})
