/**
 * Extension API key auth — v0.7.8. Per-admin keys for the browser extension, distinct
 * from service-level BACKEND_API_KEY. Key = `kb_ext_` + 32 base62 chars; only the
 * sha256 hash is persisted; verification is constant-time.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from './db'
import { extensionKeys } from './schema'

export const EXT_KEY_PREFIX = 'kb_ext_'
const KEY_RANDOM_BYTES = 32

export interface ExtensionKeyContext {
  id: string
  name: string
  createdBy: string
  canForceRating: boolean
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function base62(bytes: number): string {
  // Rejection sampling (b < 248) avoids modulo bias without BigInt — bundler compat.
  const alpha = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const out: string[] = []
  while (out.length < bytes) {
    const b = randomBytes(1)[0]!
    if (b < 248) out.push(alpha.charAt(b % 62))
  }
  return out.join('')
}

/** Generate a new key: returns raw (shown to admin once), visible prefix, and persisted sha256 hash. */
export function generateExtensionKey(): { raw: string; prefix: string; hash: string } {
  const raw = `${EXT_KEY_PREFIX}${base62(32)}`
  return { raw, prefix: raw.slice(0, 12), hash: hashKey(raw) }
}

/**
 * Verify a raw key (timing-safe). Returns null if malformed, unknown, revoked,
 * or hash mismatch. Side effect: best-effort last_used_at update.
 */
export async function verifyExtensionKey(raw: string | undefined | null): Promise<ExtensionKeyContext | null> {
  if (!raw || !raw.startsWith(EXT_KEY_PREFIX)) return null
  const hash = hashKey(raw)

  const rows = await db.select({
    id: extensionKeys.id,
    name: extensionKeys.name,
    createdBy: extensionKeys.createdBy,
    canForceRating: extensionKeys.canForceRating,
    keyHash: extensionKeys.keyHash,
    revokedAt: extensionKeys.revokedAt,
  })
    .from(extensionKeys)
    .where(and(eq(extensionKeys.keyHash, hash), isNull(extensionKeys.revokedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const a = Buffer.from(row.keyHash)
  const b = Buffer.from(hash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  // Best-effort last-used update; never block the request on it.
  db.update(extensionKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(extensionKeys.id, row.id))
    .catch(() => { /* swallow — observability, not auth */ })

  return {
    id: row.id,
    name: row.name,
    createdBy: row.createdBy,
    canForceRating: row.canForceRating,
  }
}

if (process.env.NODE_ENV !== 'production') {
  ;(async () => {
    const a = generateExtensionKey()
    const b = generateExtensionKey()
    const assert = (cond: boolean, msg: string) => { if (!cond) console.warn(`[extension-auth] self-check: ${msg}`) }
    assert(a.raw.startsWith(EXT_KEY_PREFIX), 'raw has prefix')
    assert(a.raw.length === EXT_KEY_PREFIX.length + 32, 'raw is 32 chars + prefix')
    assert(a.raw !== b.raw, 'generator produces unique keys')
    assert(a.hash === hashKey(a.raw), 'hash is deterministic')
    assert(a.hash !== b.hash, 'different keys hash differently')
    assert(a.prefix === a.raw.slice(0, 12), 'prefix is first 12 chars')
    assert(a.raw === `${EXT_KEY_PREFIX}${a.raw.slice(EXT_KEY_PREFIX.length)}`, 'strip round-trips')
  })()
}
