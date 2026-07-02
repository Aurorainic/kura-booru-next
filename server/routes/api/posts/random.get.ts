export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  const post = await getRandomPost(isAdmin)
  if (!post) throw createError({ statusCode: 404, statusMessage: 'No posts' })
  return post
})
