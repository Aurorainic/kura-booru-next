export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ scope: 'unrated' | 'all' | { rating: string }; limit?: number }>(event)
  const scope = body?.scope || 'unrated'
  const limit = Math.min(body?.limit || 50, 100)

  let normalizedScope: 'unrated' | 'all' | { rating: any }
  if (typeof scope === 'object' && scope.rating) {
    normalizedScope = { rating: scope.rating as any }
  } else {
    normalizedScope = (scope as 'unrated' | 'all') || 'unrated'
  }

  const results = await suggestRatings(normalizedScope, limit)

  return { suggestions: results }
})
