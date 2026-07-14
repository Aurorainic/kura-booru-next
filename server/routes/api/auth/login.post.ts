export default defineEventHandler(async (event) => {
  const body = await readBody<{ username: string; password: string }>(event)
  if (!body?.username || !body?.password) {
    throw createError({ statusCode: 400, statusMessage: 'username and password required' })
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
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts. Try again later.' })
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
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  // Reset counters on successful login
  await redis.del(failKey)
  await redis.del(lockKey)

  const token = await createSession(admin.id)
  setSessionCookie(event, token)

  return { ok: true, is_admin: true }
})
