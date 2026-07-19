import { definePublicHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'

export default definePublicHandler({
  doc: { method: 'post', path: '/api/auth/login', summary: 'Admin login (brute-force lockout preserved)' },
  handler: async ({ event }) => {
    const body = await readBody<{ username: string; password: string }>(event)
    if (!body?.username || !body?.password) {
      throw new AppError('VALIDATION_FAILED', 400, 'username and password required')
    }

    // S5: brute-force lockout. IP+user key hits >=5 failures in 5min → 60s lock.
    // Key is independent of password so leaked DBs still can't bypass the gate.
    // ponytail: lock is single-bucket per (ip,user) — fine for one admin site;
    // multi-account attacks would need a wider IP-only bucket.
    const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
    const failKey = `login:fail:${ip}:${body.username}`
    const lockKey = `login:lock:${ip}:${body.username}`

    const isLocked = await redis.get(lockKey)
    if (isLocked) {
      throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Try again later.')
    }

    // verifyAdminLogin, createSession auto-imported by Nitro
    const admin = await verifyAdminLogin(body.username, body.password)
    if (!admin) {
      const fails = await redis.incr(failKey)
      if (fails === 1) await redis.expire(failKey, 300)
      if (fails >= 5) {
        await redis.set(lockKey, '1', { EX: 60 })
        await redis.del(failKey)
      }
      throw new AppError('UNAUTHORIZED', 401, 'Invalid credentials')
    }

    // Reset counters on successful login
    await redis.del(failKey)
    await redis.del(lockKey)

    const token = await createSession(admin.id)
    setSessionCookie(event, token)

    return { ok: true, is_admin: true }
  },
})
