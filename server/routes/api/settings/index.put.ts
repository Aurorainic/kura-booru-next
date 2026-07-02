export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ settings: Record<string, string> }>(event)
  if (!body?.settings) throw createError({ statusCode: 400, statusMessage: 'settings object required' })
  await updateSettings(body.settings)
  return { settings: await db.select().from(settings) }
})
