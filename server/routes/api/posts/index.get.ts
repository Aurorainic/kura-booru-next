export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)

  // B-P3-8: ?q= parameter triggers search
  if (query.q) {
    return searchPosts(query.q as string, {
      page: Number(query.page) || 1,
      perPage: Number(query.per_page) || 40,
      source: query.source as string | undefined,
      isAdmin,
    })
  }

  return listPosts({
    page: Number(query.page) || 1,
    perPage: Number(query.per_page) || 40,
    rating: query.rating as any,
    isAdmin,
  })
})
