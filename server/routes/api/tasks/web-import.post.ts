
export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ urls: string[] }>(event)
  if (!body?.urls?.length) throw createError({ statusCode: 400, statusMessage: 'urls required' })

  const results = await Promise.all(body.urls.slice(0, 50).map(async (url) => {
    try {
      const jobId = await enqueueJob({ url })
      return { task_id: jobId, status: 'queued' }
    } catch (e: any) {
      return { status: 'error', error: e.message }
    }
  }))

  return { results }
})
