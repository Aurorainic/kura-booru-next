import { eq, ilike, and, isNotNull, isNull, sql } from 'drizzle-orm'
import { defineAdminHandler } from '../../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/admin/tags', summary: 'Admin tag list' },
  handler: async ({ event }) => {
    const query = getQuery(event)
    const page = Number(query.page) || 1
    const perPage = Number(query.per_page) || 40
    const offset = (page - 1) * perPage

    const conditions = []
    if (query.category) conditions.push(eq(tags.category, query.category as any))
    if (query.q) conditions.push(ilike(tags.name, (query.q as string) + '%'))
    if (query.ai_status === 'processed') conditions.push(isNotNull(tags.aiProcessedAt))
    if (query.ai_status === 'unprocessed') conditions.push(isNull(tags.aiProcessedAt))

    const where = conditions.length ? and(...conditions) : undefined
    const orderBy = query.sort === 'name' ? tags.name : sql`post_count desc`

    const [countResult, items] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(tags).where(where),
      db.select().from(tags).where(where).orderBy(orderBy).limit(perPage).offset(offset),
    ])

    const total = Number(countResult[0]?.count || 0)
    return { items: items.map(serializeTag), total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) }
  },
})
