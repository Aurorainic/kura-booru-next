
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = query.q as string
  if (!q) throw createError({ statusCode: 400, statusMessage: 'q parameter required' })

  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)

  return searchPosts(q, {
    page: Number(query.page) || 1,
    perPage: Number(query.per_page) || 40,
    source: query.source as string,
    isAdmin,
  })
})
