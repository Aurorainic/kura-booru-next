export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = query.q as string
  if (!q) return []
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  return autocompleteTags(q, isAdmin, Number(query.per_page) || 10)
})
