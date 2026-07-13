
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)

  const path = event.context.params?._?.toString() || ''

  // /api/tags/:name — the dedicated /api/tags/autocomplete.get.ts handles that
  // exact path; route the catch-all around it so a tag literally named
  // "autocomplete" is still resolvable.
  if (path && path !== 'autocomplete') {
    const tag = await getTagByName(path, isAdmin)
    if (!tag) throw createError({ statusCode: 404, statusMessage: 'Tag not found' })
    return tag
  }

  // /api/tags (list) — falls through here for both path === '' and the
  // autocomplete branch (which has its own route file and never reaches us).
  return listTags({
    category: query.category as any,
    sort: query.sort as string || 'count',
    page: Number(query.page) || 1,
    perPage: Number(query.per_page) || 40,
    isAdmin,
  })
})
