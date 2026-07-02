import { eq, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ tag_name: string; target_rating: string }>(event)
  if (!body?.tag_name || !body?.target_rating) {
    throw createError({ statusCode: 400, statusMessage: 'tag_name and target_rating required' })
  }
  const tagName = body.tag_name.trim().toLowerCase()

  // B-P3-5: Check for duplicate rule
  const existing = await db.select().from(autoRatingRules)
    .where(and(eq(autoRatingRules.tagName, tagName), eq(autoRatingRules.targetRating, body.target_rating as any)))
    .limit(1)
  if (existing[0]) {
    throw createError({ statusCode: 409, statusMessage: 'Rule already exists for this tag and rating' })
  }

  const [rule] = await db.insert(autoRatingRules).values({
    tagName,
    targetRating: body.target_rating as any,
  }).returning()
  setResponseStatus(event, 201)
  return serializeAutoRatingRule(rule)
})
