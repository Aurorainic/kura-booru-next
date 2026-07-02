export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)

  const id = event.context.params?.id as string
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Post ID required' })

  const post = await getPost(id, isAdmin)
  if (!post) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return post
})
