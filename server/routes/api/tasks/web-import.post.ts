
export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ urls: string[] }>(event)
  if (!body?.urls?.length) throw createError({ statusCode: 400, statusMessage: 'urls required' })

  const results = await Promise.all(body.urls.slice(0, 50).map(async (url) => {
    try {
      let host: string
      try { host = new URL(url).hostname }
      catch { return { status: 'error', url, error: 'invalid URL' } }
      if (await isPrivateHost(host)) return { status: 'error', url, error: 'private/reserved host' }
      const jobId = await enqueueJob({ url })
      return { task_id: jobId, status: 'queued' as const, url }
    } catch (e: any) {
      return { status: 'error' as const, url, error: e.message }
    }
  }))

  return { results }
})
