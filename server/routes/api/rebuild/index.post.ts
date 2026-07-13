
export default defineEventHandler(async (event) => {
  const apiKey = getHeader(event, 'x-api-key')
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!await checkApiKey(apiKey) && !isAdmin) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody<{ paths: string[] }>(event)
  if (!body?.paths?.length) throw createError({ statusCode: 400, statusMessage: 'paths required' })

  // Cap fanout: 50 paths max per request. Purges are local — anything beyond
  // 50 in one batch is operator error or a probe.
  const paths = body.paths.slice(0, 50)

  // SSRF guard: each path must resolve to the same origin as SITE_URL.
  // Without this, a caller can pass `//evil.com/foo` or absolute URLs and make
  // us PURGE attacker-controlled hosts. Sidecar's isPrivateHost covers the
  // image pipeline, but rebuild is a different surface.
  let siteOrigin: string
  try {
    siteOrigin = new URL(process.env.SITE_URL || 'http://localhost:3000').origin
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'SITE_URL misconfigured' })
  }

  const safePaths: string[] = []
  const rejected: string[] = []
  for (const p of paths) {
    if (typeof p !== 'string' || !p.startsWith('/')) {
      rejected.push(p); continue
    }
    try {
      if (new URL(p, siteOrigin).origin !== siteOrigin) {
        rejected.push(p); continue
      }
    } catch {
      rejected.push(p); continue
    }
    safePaths.push(p)
  }

  const results = await Promise.all(safePaths.map(async (path) => {
    try {
      const resp = await fetch(`${siteOrigin}${path}`, { method: 'PURGE' })
      return resp.ok || resp.status === 204 || resp.status === 404 ? { ok: true, path } : { ok: false, path }
    } catch {
      return { ok: false, path }
    }
  }))
  const purged = results.filter(r => r.ok).map(r => r.path)
  const errors = [...results.filter(r => !r.ok).map(r => r.path), ...rejected]

  return { purged, errors }
})
