import { eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const query = getQuery(event)
  const page = Number(query.page) || 1
  const perPage = Number(query.per_page) || 50
  const offset = (page - 1) * perPage

  const [countResult, items] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(tagAliases),
    db.select({
      id: tagAliases.id,
      alias_name: tagAliases.aliasName,
      tag_id: tagAliases.tagId,
      tag_name: tags.name,
    })
      .from(tagAliases)
      .innerJoin(tags, eq(tagAliases.tagId, tags.id))
      .limit(perPage)
      .offset(offset),
  ])

  const total = Number(countResult[0]?.count || 0)
  return {
    items: items.map(i => ({
      id: i.id,
      alias_name: i.alias_name,
      tag_id: i.tag_id,
      tag_name: i.tag_name,
    })),
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  }
})
