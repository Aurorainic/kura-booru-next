import { defineAdminHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { getSettings } from '../../../utils/settings'

export default defineAdminHandler({
  doc: { method: 'put', path: '/api/settings', summary: 'Update settings' },
  handler: async ({ event }) => {
    const body = await readBody<{ settings: Record<string, string> }>(event)
    if (!body?.settings) throw new AppError('VALIDATION_FAILED', 400, 'settings object required')
    await updateSettings(body.settings)
    return { settings: await getSettings() }
  },
})
