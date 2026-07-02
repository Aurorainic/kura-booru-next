import { eq } from 'drizzle-orm'

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

  await db.update(posts).set({ rating: body.rating as any }).where(eq(posts.id, id))
  const [updated] = await db.update(posts)
    .set({ rating: body.rating as any })
    .where(eq(posts.id, id))
    .returning()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  return serializePost(updated)
})
