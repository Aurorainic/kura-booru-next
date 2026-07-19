import { eq } from 'drizzle-orm'
import { defineApiKeyHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { zRating } from '../../../platform/schemas/enums'
import { serializePost } from '../../../modules/posts/serialize'

// SECURITY: API-key path is rate-limited to bound blast radius of a leaked key.
// A leaked key can still flip ratings, but capped at 30/min/IP — and we audit
// every call so misuse is detectable. Full split to /api/posts/:id/rate with a
// user-bound token is tracked as a follow-up.
export default defineApiKeyHandler({
  auditAction: 'rating mutation',
  doc: { method: 'patch', path: '/api/posts/:id', summary: 'Update post rating (session or apikey)' },
  handler: async ({ event }) => {
    const id = event.context.params?.id as string
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'Post ID required')

    const body = await readBody<{ rating: string }>(event)
    if (!body?.rating) throw new AppError('VALIDATION_FAILED', 400, 'rating required')
    // zRating validates, but keep the runtime check for non-schema path
    const allowed = ['safe', 'questionable', 'explicit']
    if (!allowed.includes(body.rating)) throw new AppError('VALIDATION_FAILED', 400, 'Invalid rating')

    const [updated] = await db.update(posts)
      .set({ rating: body.rating as any })
      .where(eq(posts.id, id))
      .returning()
    if (!updated) throw new AppError('NOT_FOUND', 404, 'Post not found')
    return serializePost(updated)
  },
})
