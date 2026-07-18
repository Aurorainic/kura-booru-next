export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'job id required' })

  const status = await getAiJobStatus(id)
  if (!status) {
    // Expired or never existed — return a terminal "not found" rather than 404
    // so the client can treat it as completed-vanished and stop polling.
    return { id, status: 'gone' as const, total: 0, done: 0, errors: [], started_at: 0 }
  }
  return status
})
