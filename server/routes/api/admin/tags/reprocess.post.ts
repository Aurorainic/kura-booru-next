import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/tags/reprocess', summary: 'Reprocess tags via AI' },
  handler: async ({ event }) => {
    const body = await readBody<{ mode: 'unprocessed' | 'all' }>(event)
    const mode = body?.mode || 'unprocessed'

    if (mode !== 'unprocessed' && mode !== 'all') {
      throw new AppError('VALIDATION_FAILED', 400, 'mode must be "unprocessed" or "all"')
    }

    const result = await reprocessTags(mode)
    return result
  },
})
