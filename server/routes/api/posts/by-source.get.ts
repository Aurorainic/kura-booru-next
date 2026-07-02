export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const sourceSite = query.source_site as string
  const sourceId = query.source_id as string
  if (!sourceSite || !sourceId) throw createError({ statusCode: 400, statusMessage: 'source_site and source_id required' })
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  const post = await getPostBySource(sourceSite, sourceId, isAdmin)
  if (!post) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return post
})
