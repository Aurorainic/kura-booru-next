export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  // Reuse getSettings() — cached, projects to { key: value } shape. Avoids
  // a fresh SELECT * per request and prevents accidentally exposing future
  // columns (database_url / redis_url etc.) that raw select() would leak.
  return { settings: await getSettings() }
})
