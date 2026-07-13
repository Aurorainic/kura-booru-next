import crypto from 'crypto'
import bcryptjs from 'bcryptjs'
import { db } from './db'
import { admins } from '../schema/admins'
import { eq } from 'drizzle-orm'
import { redis } from './redis'

// ponytail: refuse to start in production with the public dev fallback secret.
// Without this guard, anyone reading the repo can forge kura_admin_session.
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.SECRET_KEY || 'dev-secret-change-me'
if (process.env.NODE_ENV === 'production' && SESSION_SECRET === 'dev-secret-change-me') {
  throw new Error('SESSION_SECRET (or SECRET_KEY) must be set in production — refusing to sign admin cookies with the public dev fallback')
}
const SESSION_COOKIE = 'kura_admin_session'
const MAX_AGE = parseInt(process.env.ADMIN_SESSION_MAX_AGE || '604800', 10) // 7 days
const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}
export function setSessionCookie(event: any, token: string) {
  setCookie(event, SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTS, maxAge: MAX_AGE })
}
export function clearSessionCookie(event: any) {
  // deleteCookie must match every attribute used at set time, otherwise browsers
  // keep the cookie (CLAUDE.md cookie deletion note). Inline the unset instead.
  setCookie(event, SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTS, maxAge: 0 })
}

// ── Signed cookie with iat (B-P1-1, B-P1-2) ──
// Format: value.iat.signature

function sign(value: string): string {
  const iat = Math.floor(Date.now() / 1000)
  const payload = `${value}.${iat}`
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
  return `${payload}.${sig}`
}

function unsign(token: string): { value: string; iat: number } | null {
  // token format: value.iat.sig
  const firstDot = token.indexOf('.')
  const lastDot = token.lastIndexOf('.')
  if (firstDot === -1 || firstDot === lastDot) return null

  const value = token.slice(0, firstDot)
  const iatStr = token.slice(firstDot + 1, lastDot)
  const sig = token.slice(lastDot + 1)

  const payload = `${value}.${iatStr}`
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')

  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null
  }

  const iat = parseInt(iatStr, 10)
  if (isNaN(iat)) return null

  // ── Max age check (B-P1-2) ──
  if (Date.now() / 1000 - iat > MAX_AGE) return null

  return { value, iat }
}

// ── Password epoch with admin cache (B-P3-13: 30s TTL, 256 entries) ──
const epochCache: { changedAt: number | null; at: number } = { changedAt: null, at: 0 }
const EPOCH_CACHE_TTL = 10_000

// ponytail: simple admin cache — per-token-hash, 30s TTL
const adminCache = new Map<string, { result: boolean; at: number }>()
const ADMIN_CACHE_TTL = 30_000
const ADMIN_CACHE_MAX = 256

export async function getIsAdmin(cookieHeader: string): Promise<boolean> {
  if (!cookieHeader) return false
  const cookies = parseCookies(cookieHeader)
  const token = cookies[SESSION_COOKIE]
  if (!token) return false

  // Check admin cache first
  const cacheKey = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
  const cached = adminCache.get(cacheKey)
  if (cached && Date.now() - cached.at < ADMIN_CACHE_TTL) {
    return cached.result
  }

  const parsed = unsign(token)
  if (!parsed) {
    // Cache negative result
    if (adminCache.size >= ADMIN_CACHE_MAX) {
      // Evict oldest entry
      const oldest = [...adminCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) adminCache.delete(oldest[0])
    }
    adminCache.set(cacheKey, { result: false, at: Date.now() })
    return false
  }

  // ── Password epoch check (B-P1-1) ──
  const now = Date.now()
  if (now - epochCache.at > EPOCH_CACHE_TTL) {
    try {
      const cached = await redis.get('kura:password_epoch')
      epochCache.changedAt = cached ? Number(cached) : null
      epochCache.at = now
    } catch {
      // Redis down → fail-open (allow session), per CLAUDE.md.
      // ponytail: don't cache fail-open — retry Redis on next request so recovery is fast.
      return true
    }
  }

  // If password was changed after session was issued → invalid
  if (epochCache.changedAt !== null && parsed.iat * 1000 < epochCache.changedAt) {
    adminCache.set(cacheKey, { result: false, at: Date.now() })
    return false
  }

  // Verify admin exists
  const admin = await db.select({ id: admins.id }).from(admins).where(eq(admins.id, parsed.value)).limit(1)
  const result = !!admin[0]

  // Cache result
  if (adminCache.size >= ADMIN_CACHE_MAX) {
    const oldest = [...adminCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) adminCache.delete(oldest[0])
  }
  adminCache.set(cacheKey, { result, at: Date.now() })

  return result
}

export async function verifyAdminLogin(username: string, password: string) {
  const admin = await db.select().from(admins).where(eq(admins.username, username)).limit(1)
  if (!admin[0]) return null
  if (!(await verifyAdminPassword(admin[0], password))) return null
  return admin[0]
}

// ponytail: bcrypt compare pulled out of verifyAdminLogin so the change-password route
// can verify the current password without re-fetching the admin row.
export async function verifyAdminPassword(admin: { passwordHash: string }, password: string): Promise<boolean> {
  return bcryptjs.compare(password, admin.passwordHash)
}

export function createSession(adminId: string): string {
  return sign(adminId)
}

// Exported so other handlers can extract adminId without duplicating crypto logic.
// Returns null on invalid/expired tokens.
export function parseSession(token: string): { value: string; iat: number } | null {
  return unsign(token)
}

export const SESSION_MAX_AGE = MAX_AGE

export async function changeAdminPassword(adminId: string, newPassword: string) {
  if (newPassword.length < 6) {
    throw Object.assign(new Error('Password must be at least 6 characters'), { statusCode: 400 })
  }
  const hash = await bcryptjs.hash(newPassword, 12)
  const now = new Date()
  await db.update(admins).set({ passwordHash: hash, passwordChangedAt: now }).where(eq(admins.id, adminId))
  const epoch = now.getTime()
  await redis.set('kura:password_epoch', String(epoch))
  epochCache.changedAt = epoch
  epochCache.at = Date.now()
  // Clear admin cache to force re-auth
  adminCache.clear()
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) cookies[k] = v.join('=')
  }
  return cookies
}
