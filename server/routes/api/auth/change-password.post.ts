import { eq } from 'drizzle-orm'
import { defineAdminHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/auth/change-password', summary: 'Change admin password' },
  handler: async ({ event }) => {
    const body = await readBody<{ current_password: string; new_password: string }>(event)
    if (!body?.current_password || !body?.new_password) {
      throw new AppError('VALIDATION_FAILED', 400, 'Both passwords required')
    }

    const cookie = getHeader(event, 'cookie') || ''
    const cookies = parseCookies(cookie)
    const token = cookies['kura_admin_session']
    if (!token) throw new AppError('UNAUTHORIZED', 401, 'No session')

    // Use the shared session parser — includes MAX_AGE check that the previous
    // inline crypto duplicated and silently dropped.
    const parsed = parseSession(token)
    if (!parsed) throw new AppError('SESSION_EXPIRED', 401, 'Invalid or expired session')
    const adminId = parsed.value

    const adminRows = await db.select().from(admins).where(eq(admins.id, adminId)).limit(1)
    if (!adminRows[0]) throw new AppError('ADMIN_NOT_FOUND', 401, 'Admin not found')

    const match = await verifyAdminPassword(adminRows[0], body.current_password)
    if (!match) throw new AppError('PASSWORD_INCORRECT', 401, 'Current password incorrect')

    await changeAdminPassword(adminRows[0].id, body.new_password)
    clearSessionCookie(event)
    return { ok: true }
  },
})
