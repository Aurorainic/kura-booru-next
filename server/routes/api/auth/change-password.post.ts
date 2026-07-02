import { eq } from 'drizzle-orm'
import bcryptjs from 'bcryptjs'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ current_password: string; new_password: string }>(event)
  if (!body?.current_password || !body?.new_password) {
    throw createError({ statusCode: 400, statusMessage: 'Both passwords required' })
  }

  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // B-P3-4: Extract admin ID from session token (not SELECT ... LIMIT 1)
  const cookies = Object.fromEntries(cookie.split(';').map(p => { const [k, ...v] = p.trim().split('='); return [k, v.join('=')] }))
  const token = cookies['kura_admin_session']
  if (!token) throw createError({ statusCode: 401, statusMessage: 'No session' })

  // Parse session to get admin ID — inline unsign logic (auth.ts unsign is auto-imported by Nitro
  // but not easily callable here without the module export being accessible)
  let adminId: string
  try {
    const { createHmac, timingSafeEqual } = await import('crypto')
    const SESSION_SECRET = process.env.SESSION_SECRET || process.env.SECRET_KEY || 'dev-secret-change-me'
    const firstDot = token.indexOf('.')
    const lastDot = token.lastIndexOf('.')
    if (firstDot === -1 || firstDot === lastDot) throw new Error('invalid')
    const value = token.slice(0, firstDot)
    const sig = token.slice(lastDot + 1)
    const payload = token.slice(0, lastDot)
    const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('invalid')
    adminId = value
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid session' })
  }

  const adminRows = await db.select().from(admins).where(eq(admins.id, adminId)).limit(1)
  if (!adminRows[0]) throw createError({ statusCode: 401, statusMessage: 'Admin not found' })

  const match = await bcryptjs.compare(body.current_password, adminRows[0].passwordHash)
  if (!match) throw createError({ statusCode: 401, statusMessage: 'Current password incorrect' })

  await changeAdminPassword(adminRows[0].id, body.new_password)
  deleteCookie(event, 'kura_admin_session', { path: '/', secure: true, httpOnly: true, sameSite: 'lax' })
  return { ok: true }
})
