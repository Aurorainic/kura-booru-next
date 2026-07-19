import { defineAdminHandler } from '../../../../../platform/http/auth'
import { AppError } from '../../../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/admin/ai/jobs/:id', summary: 'AI job status' },
  handler: async ({ event }) => {
    const id = getRouterParam(event, 'id')
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'job id required')

    const status = await getAiJobStatus(id)
    if (!status) {
      // Expired or never existed — return a terminal "not found" rather than 404
      // so the client can treat it as completed-vanished and stop polling.
      return { id, status: 'gone' as const, total: 0, done: 0, errors: [], started_at: 0 }
    }
    return status
  },
})
