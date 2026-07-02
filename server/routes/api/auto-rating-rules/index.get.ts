export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const rules = await db.select().from(autoRatingRules).orderBy(autoRatingRules.tagName)
  return rules.map(serializeAutoRatingRule)
})
