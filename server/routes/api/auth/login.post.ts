import { definePublicHandler, getClientIp } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'

export default definePublicHandler({
  doc: { method: 'post', path: '/api/auth/login', summary: 'Admin login (brute-force lockout preserved)' },
  handler: async ({ event }) => {
    const body = await readBody<{ username: string; password: string }>(event)
    if (!body?.username || !body?.password) {
      throw new AppError('VALIDATION_FAILED', 400, 'username and password required')
    }

    // S5: brute-force lockout. IP+user key: >=5 failures in 5min → 60s lock.
    // Key independent of password — leaked DBs still can't bypass the gate.
    const ip = getClientIp(event)
    const failKey = `login:fail:${ip}:${body.username}`
    const lockKey = `login:lock:${ip}:${body.username}`

    try {
      const isLocked = await redis.get(lockKey)
      if (isLocked) {
        throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Try again later.')
      }
    } catch (err) {
      // Redis down → fail-open: allow login to proceed — otherwise an outage
      // would permanently lock out the admin.
      if (!(err instanceof AppError)) {
        console.warn('[login] Redis unavailable, skipping rate-limit check')
      } else {
        throw err
      }
    }

    // verifyAdminLogin, createSession auto-imported by Nitro
    const admin = await verifyAdminLogin(body.username, body.password)
    if (!admin) {
      try {
        const fails = await redis.incr(failKey)
        if (fails === 1) await redis.expire(failKey, 300)
        if (fails >= 5) {
          await redis.set(lockKey, '1', { EX: 60 })
          await redis.del(failKey)
        }
      } catch {
        // Redis down — fail-open: allow retry without lockout tracking.
        console.warn('[login] Redis unavailable, skipping failure tracking')
      }
      throw new AppError('UNAUTHORIZED', 401, 'Invalid credentials')
    }

    // Reset counters on successful login
    try {
      await redis.del(failKey)
      await redis.del(lockKey)
    } catch {
      // Non-fatal: Redis down, counters reset on next restart.
    }

    const token = await createSession(admin.id)
    setSessionCookie(event, token)

    return { ok: true, is_admin: true }
  },
})
