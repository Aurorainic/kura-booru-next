import { eq } from 'drizzle-orm'
import { parseCookies } from 'h3'
import { admins } from '../schema'
import { redis } from './redis'
import { unsign, SESSION_COOKIE } from './auth'

// ponytail: best-effort identity lookup for audit fields. Returns the
// admin's username if the session is valid; null if cookie is missing/
// unsigned. Never throws — audit metadata is non-critical.
export async function getAdminUsernameFromCookie(cookieHeader: string): Promise<string | null> {
  if (!cookieHeader) return null
  const token = parseCookies(cookieHeader)[SESSION_COOKIE]
  if (!token) return null
  const parsed = unsign(token)
  if (!parsed) return null

  try {
    const rows = await db.select({ username: admins.username }).from(admins).where(eq(admins.id, parsed.value)).limit(1)
    return rows[0]?.username ?? null
  } catch {
    return null
  }
}