import { eq } from 'drizzle-orm'

// SECURITY: API-key path is rate-limited to bound blast radius of a leaked key.
// A leaked key can still flip ratings, but capped at 30/min/IP — and we audit
// every call so misuse is detectable. Full split to /api/posts/:id/rate with a
// user-bound token is tracked as a follow-up.
const API_KEY_RATE_LIMIT = 30
const API_KEY_RATE_WINDOW = 60_000

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  const apiKey = getHeader(event, 'x-api-key')
  const hasApiKey = await checkApiKey(apiKey)

  if (!isAdmin && !hasApiKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const id = event.context.params?.id as string
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Post ID required' })

  const body = await readBody<{ rating: string }>(event)
  if (!body?.rating) throw createError({ statusCode: 400, statusMessage: 'rating required' })
  const allowed = ['safe', 'questionable', 'explicit']
  if (!allowed.includes(body.rating)) throw createError({ statusCode: 400, statusMessage: 'Invalid rating' })

  // API-key callers get rate-limited + audit-logged. Admin cookie sessions skip
  // both (they already have first-class auth + session timeout).
  if (!isAdmin && hasApiKey) {
    const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
    const rlKey = `apikey:rate:${ip}`
    const count = await redis.incr(rlKey)
    if (count === 1) await redis.expire(rlKey, Math.ceil(API_KEY_RATE_WINDOW / 1000))
    if (count > API_KEY_RATE_LIMIT) {
      throw createError({ statusCode: 429, statusMessage: 'Rate limit exceeded' })
    }
    console.warn('[audit] api-key rating mutation', { postId: id, rating: body.rating, ip })
  }

  const [updated] = await db.update(posts)
    .set({ rating: body.rating as any })
    .where(eq(posts.id, id))
    .returning()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  return serializePost(updated)
})
