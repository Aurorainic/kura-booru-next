import { defineAdminHandler } from '../../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/admin/dashboard/system-status', summary: 'Queue depth' },
  handler: async () => {
    try {
      const depth = await (redis as any).llen('kura:jobs')
      return { queue_depth: depth }
    } catch {
      return { queue_depth: 0 }
    }
  },
})
