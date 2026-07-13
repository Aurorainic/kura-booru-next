
export default defineEventHandler(async (event) => {
  const apiKey = getHeader(event, 'x-api-key')
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!await checkApiKey(apiKey) && !isAdmin) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody<{ paths: string[] }>(event)
  if (!body?.paths?.length) throw createError({ statusCode: 400, statusMessage: 'paths required' })

  const siteUrl = process.env.SITE_URL || 'http://localhost:3000'

  const results = await Promise.all(body.paths.map(async (path) => {
    try {
      const resp = await fetch(`${siteUrl}${path}`, { method: 'PURGE' })
      return resp.ok || resp.status === 204 || resp.status === 404 ? { ok: true, path } : { ok: false, path }
    } catch {
      return { ok: false, path }
    }
  }))
  const purged = results.filter(r => r.ok).map(r => r.path)
  const errors = results.filter(r => !r.ok).map(r => r.path)

  return { purged, errors }
})
