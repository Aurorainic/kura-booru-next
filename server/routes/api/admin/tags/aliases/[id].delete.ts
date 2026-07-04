import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = event.context.params?.id as string
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Alias ID required' })

  const existing = await db.select().from(tagAliases).where(eq(tagAliases.id, id)).limit(1)
  if (!existing[0]) throw createError({ statusCode: 404, statusMessage: 'Alias not found' })

  await db.delete(tagAliases).where(eq(tagAliases.id, id))

  return { deleted: true }
})
