import { eq } from 'drizzle-orm'
import { admins } from '../schema'
import { parseCookieHeader, parseSession } from './auth'

export async function getAdminUsernameFromCookie(cookieHeader: string): Promise<string | null> {
  if (!cookieHeader) return null
  const token = parseCookieHeader(cookieHeader)['kura_admin_session']
  if (!token) return null
  const parsed = parseSession(token)
  if (!parsed) return null

  try {
    const rows = await db.select({ username: admins.username }).from(admins).where(eq(admins.id, parsed.value)).limit(1)
    return rows[0]?.username ?? null
  } catch {
    return null
  }
}
