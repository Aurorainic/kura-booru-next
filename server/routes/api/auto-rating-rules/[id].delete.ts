import { eq } from 'drizzle-orm'
import { defineAdminHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'delete', path: '/api/auto-rating-rules/:id', summary: 'Delete auto-rating rule' },
  handler: async ({ event }) => {
    const id = event.context.params?.id as string
    const result = await db.delete(autoRatingRules).where(eq(autoRatingRules.id, id)).returning()
    if (!result.length) throw new AppError('NOT_FOUND', 404, 'Not found')
    return new Response(null, { status: 204 })
  },
})
