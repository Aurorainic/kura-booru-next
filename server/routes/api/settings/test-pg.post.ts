export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody(event)
  const { url } = body

  if (!url || typeof url !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'URL required' })
  }

  // SSRF prevention: validate scheme and resolve hostname
  try {
    const parsed = new URL(url)
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      return { ok: false, error: 'Only postgres:// URLs are allowed' }
    }
    if (await isPrivateHost(parsed.hostname)) {
      return { ok: false, error: 'Internal/private IP not allowed' }
    }
  } catch (e: any) {
    return { ok: false, error: `Invalid URL: ${e.message}` }
  }

  try {
    const postgres = await import('postgres')
    const sql = postgres.default(url, { connect_timeout: 5, idle_timeout: 5, max: 1 })
    await sql`SELECT 1`
    await sql.end({ timeout: 3 })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})
