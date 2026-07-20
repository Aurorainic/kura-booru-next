import { eq, and } from 'drizzle-orm'
import { defineAdminHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/auto-rating-rules', summary: 'Create auto-rating rule' },
  handler: async ({ event }) => {
    const body = await readBody<{ tag_name: string; target_rating: string }>(event)
    if (!body?.tag_name || !body?.target_rating) {
      throw new AppError('VALIDATION_FAILED', 400, 'tag_name and target_rating required')
    }
    const tagName = body.tag_name.trim().toLowerCase()

    // B-P3-5: Check for duplicate rule
    const existing = await db.select().from(autoRatingRules)
      .where(and(eq(autoRatingRules.tagName, tagName), eq(autoRatingRules.targetRating, body.target_rating as any)))
      .limit(1)
    if (existing[0]) {
      throw new AppError('CONFLICT', 409, 'Rule already exists for this tag and rating')
    }

    const [rule] = await db.insert(autoRatingRules).values({
      tagName,
      targetRating: body.target_rating as any,
    }).returning()
    setResponseStatus(event, 201)
    return serializeAutoRatingRule(rule)
  },
})
