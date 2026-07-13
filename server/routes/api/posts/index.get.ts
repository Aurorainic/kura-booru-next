export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)

  // Search is on /api/search — don't piggyback ?q= on the list endpoint.
  if (query.q) {
    throw createError({ statusCode: 400, statusMessage: 'Use /api/search for queries' })
  }

  return listPosts({
    page: Number(query.page) || 1,
    perPage: Number(query.per_page) || 40,
    rating: query.rating as any,
    isAdmin,
  })
})
