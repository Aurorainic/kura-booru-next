import { defineAdminHandler } from '../../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/admin/ai/status', summary: 'AI service status' },
  handler: async () => getAiStatus(),
})
