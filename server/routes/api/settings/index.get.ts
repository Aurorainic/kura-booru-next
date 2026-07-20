import { defineAdminHandler } from '../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/settings', summary: 'Get settings' },
  handler: async () => {
    // Reuse getSettings() — cached, projects to { key: value } shape. Avoids
    // a fresh SELECT * per request and prevents accidentally exposing future
    // columns (database_url / redis_url etc.) that raw select() would leak.
    return { settings: await getSettings() }
  },
})
