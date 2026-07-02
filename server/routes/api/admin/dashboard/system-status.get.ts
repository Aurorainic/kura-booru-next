export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  // Simple queue depth from Redis
  try {
    const depth = await (redis as any).llen('kura:jobs')
    return { queue_depth: depth }
  } catch {
    return { queue_depth: 0 }
  }
})
