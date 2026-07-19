import { defineAdminHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/settings/test-redis', summary: 'Test Redis connection' },
  handler: async ({ event }) => {
    const body = await readBody(event)
    const { url } = body

    if (!url || typeof url !== 'string') {
      throw new AppError('VALIDATION_FAILED', 400, 'URL required')
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
      // ponytail: pin DNS to resolved IP to prevent rebinding SSRF.
      const parsed = new URL(url)
      const resolved = await dnsLookup(parsed.hostname)
      const pinnedUrl = new URL(url)
      pinnedUrl.hostname = resolved
      const { createClient } = await import('redis')
      const testClient = createClient({ url: pinnedUrl.toString(), socket: { connectTimeout: 5000 } })
      await testClient.connect()
      await testClient.ping()
      await testClient.quit()
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  },
})
