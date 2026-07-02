
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
  const purged: string[] = []
  const errors: string[] = []

  for (const path of body.paths) {
    try {
      const resp = await fetch(`${siteUrl}${path}`, { method: 'PURGE' })
      if (resp.ok || resp.status === 204 || resp.status === 404) purged.push(path)
      else errors.push(path)
    } catch {
      errors.push(path)
    }
  }

  return { purged, errors }
})
