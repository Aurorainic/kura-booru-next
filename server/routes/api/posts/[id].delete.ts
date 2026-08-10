import { deletePostAndRenumberSeries } from '../../../utils/series-admin'
import { defineAdminHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'delete', path: '/api/posts/:id', summary: 'Delete post' },
  handler: async ({ event }) => {
    const id = event.context.params?.id as string
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'Post ID required')

    // v0.7.8 PR-C: shared helper handles single-image and series delete + reorder;
    // admin series nav delegates here via /api/admin/posts/[id].
    await deletePostAndRenumberSeries(id)
    return new Response(null, { status: 204 })
  },
})
