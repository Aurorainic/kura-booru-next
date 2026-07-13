export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = query.q as string
  if (!q) return []
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  // Routes through redis-search when MEILI_ENABLED=true, else SQL ILIKE
  // (autocompleteTags / suggestTags share the same SQL fallback).
  return suggestTags(q, isAdmin, Number(query.per_page) || 10)
})
