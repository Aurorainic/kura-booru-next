import { defineAdminHandler } from '../../../../platform/http/auth'
import { getSettings } from '../../../../utils/settings'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/admin/settings', summary: 'List all settings (admin)' },
  handler: async () => getSettings(),
})
