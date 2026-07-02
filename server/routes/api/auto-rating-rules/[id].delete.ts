import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = event.context.params?.id as string
  const result = await db.delete(autoRatingRules).where(eq(autoRatingRules.id, id)).returning()
  if (!result.length) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return new Response(null, { status: 204 })
})
