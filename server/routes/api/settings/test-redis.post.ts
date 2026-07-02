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
    if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
      return { ok: false, error: 'Only redis:// URLs are allowed' }
    }
    if (await isPrivateHost(parsed.hostname)) {
      return { ok: false, error: 'Internal/private IP not allowed' }
    }
  } catch (e: any) {
    return { ok: false, error: `Invalid URL: ${e.message}` }
  }

  try {
    const { createClient } = await import('redis')
    const testClient = createClient({ url, socket: { connectTimeout: 5000 } })
    await testClient.connect()
    await testClient.ping()
    await testClient.quit()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})
