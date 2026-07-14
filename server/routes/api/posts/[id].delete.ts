import { deletePostAndRenumberSeries } from '../../../utils/series-admin'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = event.context.params?.id as string
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Post ID required' })

  // v0.7.8 PR-C: shared helper handles both single-image and series
  // delete + reorder. Admin PostsPanel calls this path; admin series
  // nav calls the dedicated /api/admin/posts/[id] endpoint which
  // delegates here.
  await deletePostAndRenumberSeries(id)
  return new Response(null, { status: 204 })
})