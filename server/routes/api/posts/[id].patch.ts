import { eq } from 'drizzle-orm'

// SECURITY: BACKEND_API_KEY currently grants full admin-equivalent rating mutation.
// This is convenient for the Telegram bot's confirmRating self-call but means any
// leaked key can flip any post's rating. Tracked as a follow-up to scope the key
// to a narrow /api/posts/:id/rate endpoint with a separate rate-token; see
// docs/superpowers/specs/2026-07-13-v0.7.6-review-and-fixes-design.md §S1.
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

  const [updated] = await db.update(posts)
    .set({ rating: body.rating as any })
    .where(eq(posts.id, id))
    .returning()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  return serializePost(updated)
})
