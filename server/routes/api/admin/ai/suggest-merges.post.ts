export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ scope: 'all' | { category: string } }>(event)
  const scope = body?.scope || 'all'
  const normalizedScope = typeof scope === 'object' && scope.category
    ? { category: scope.category as any }
    : 'all' as const

  const groups = await suggestMerges(normalizedScope)

  return { suggestions: groups }
})
