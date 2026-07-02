
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)

  const path = event.context.params?._?.toString() || ''

  // /api/tags/autocomplete
  if (path === 'autocomplete') {
    const q = query.q as string
    if (!q) return []
    return autocompleteTags(q, isAdmin, Number(query.per_page) || 10)
  }

  // /api/tags/:name
  if (path) {
    const tag = await getTagByName(path, isAdmin)
    if (!tag) throw createError({ statusCode: 404, statusMessage: 'Tag not found' })
    return tag
  }

  // /api/tags (list)
  return listTags({
    category: query.category as any,
    sort: query.sort as string || 'count',
    page: Number(query.page) || 1,
    perPage: Number(query.per_page) || 40,
    isAdmin,
  })
})
