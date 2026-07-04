export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ mode: 'unprocessed' | 'all' }>(event)
  const mode = body?.mode || 'unprocessed'

  if (mode !== 'unprocessed' && mode !== 'all') {
    throw createError({ statusCode: 400, statusMessage: 'mode must be "unprocessed" or "all"' })
  }

  const result = await reprocessTags(mode)
  return result
})

