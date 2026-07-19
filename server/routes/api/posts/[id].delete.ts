import { deletePostAndRenumberSeries } from '../../../utils/series-admin'
import { defineAdminHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'delete', path: '/api/posts/:id', summary: 'Delete post' },
  handler: async ({ event }) => {
    const id = event.context.params?.id as string
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'Post ID required')

    // v0.7.8 PR-C: shared helper handles both single-image and series
    // delete + reorder. Admin PostsPanel calls this path; admin series
    // nav calls the dedicated /api/admin/posts/[id] endpoint which
    // delegates here.
    await deletePostAndRenumberSeries(id)
    return new Response(null, { status: 204 })
  },
})
