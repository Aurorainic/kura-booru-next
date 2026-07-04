import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ alias_name: string; tag_id: string }>(event)
  if (!body?.alias_name || !body?.tag_id) {
    throw createError({ statusCode: 400, statusMessage: 'alias_name and tag_id required' })
  }

  // Check target tag exists
  const target = await db.select().from(tags).where(eq(tags.id, body.tag_id)).limit(1)
  if (!target[0]) throw createError({ statusCode: 404, statusMessage: 'Target tag not found' })

  const cleanAlias = body.alias_name.trim().toLowerCase()

  const [created] = await db.insert(tagAliases).values({
    aliasName: cleanAlias,
    tagId: body.tag_id,
  }).returning()

  if (!created) throw createError({ statusCode: 500, statusMessage: 'Alias creation failed' })

  return {
    id: created.id,
    alias_name: created.aliasName,
    tag_id: created.tagId,
  }
})
