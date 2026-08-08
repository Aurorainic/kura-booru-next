import { defineAdminHandler } from '../../../platform/http/auth'
import { getAdminSettings } from '../../../utils/settings'
import { SETTING_CATEGORIES } from '../../../utils/settings-defs'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/settings', summary: 'Get settings (admin view, metadata + masked secrets)' },
  handler: async () => {
    const items = await getAdminSettings()
    return { categories: SETTING_CATEGORIES, items }
  },
})
