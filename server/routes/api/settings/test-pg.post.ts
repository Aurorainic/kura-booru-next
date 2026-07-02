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
    // ponytail: pin DNS to the resolved IP at validation time to prevent
    // rebinding — swap hostname with IP in the connection URL so the driver
    // can't resolve to a different address.
    const { default: postgres } = await import('postgres')
    const parsed = new URL(url)
    const resolved = await dnsLookup(parsed.hostname)
    const pinnedUrl = new URL(url)
    pinnedUrl.hostname = resolved
    const sql = postgres(pinnedUrl.toString(), { connect_timeout: 5, idle_timeout: 5, max: 1 })
    await sql`SELECT 1`
    await sql.end({ timeout: 3 })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})
