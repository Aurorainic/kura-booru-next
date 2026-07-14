/**
 * Extension API key auth — v0.7.8.
 *
 * Per-admin API keys for the browser extension, distinct from BACKEND_API_KEY
 * (which is service-level and shared with the Telegram bot). Each key is
 * `kb_ext_` + 32 base62 chars; only sha256 hash is persisted.
 *
 * - `generateExtensionKey()`: returns raw value (shown to admin ONCE).
 * - `verifyExtensionKey(raw)`: constant-time lookup, returns key row or null.
 * - `EXT_KEY_PREFIX` for middleware discrimination against BACKEND_API_KEY.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from './db'
import { extensionKeys } from './schema'

export const EXT_KEY_PREFIX = 'kb_ext_'
const KEY_RANDOM_BYTES = 24 // 32 base62 chars

export interface ExtensionKeyContext {
  id: string
  name: string
  createdBy: string
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function base62(bytes: number): string {
  // ponytail: base62 alphabet, no padding. 24 bytes -> 32 chars (since log(62)/log(256) ≈ 0.729).
  const alpha = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const buf = randomBytes(bytes)
  let n = 0n
  for (const b of buf) n = (n << 8n) | BigInt(b)
  let out = ''
  while (n > 0n) {
    out = alpha[Number(n % 62n)] + out
    n /= 62n
  }
  return out.slice(0, 32)
}

/**
 * Generate a new extension API key. Returns the raw value (show to admin once)
 * and the persisted metadata. The DB row stores only the hash + a short
 * visible prefix for UI identification.
 */
export function generateExtensionKey(): { raw: string; prefix: string; hash: string } {
  const raw = `${EXT_KEY_PREFIX}${base62(KEY_RANDOM_BYTES)}`
  return { raw, prefix: raw.slice(0, 12), hash: hashKey(raw) }
}

/**
 * Verify a raw key string. Returns the active key context, or null if
 * - malformed (no prefix)
 * - not found in DB
 * - revoked (revoked_at set)
 * - hash mismatch (timing-safe compare)
 *
 * Side effect: updates `last_used_at` on success (best-effort, fire-and-forget).
 */
export async function verifyExtensionKey(raw: string | undefined | null): Promise<ExtensionKeyContext | null> {
  if (!raw || !raw.startsWith(EXT_KEY_PREFIX)) return null
  const hash = hashKey(raw)

  const rows = await db.select({
    id: extensionKeys.id,
    name: extensionKeys.name,
    createdBy: extensionKeys.createdBy,
    keyHash: extensionKeys.keyHash,
    revokedAt: extensionKeys.revokedAt,
  })
    .from(extensionKeys)
    .where(and(eq(extensionKeys.keyHash, hash), isNull(extensionKeys.revokedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  // ponytail: belt-and-suspenders re-hash + timing-safe compare. SHA256 is
  // deterministic so the strings will match if the row exists, but the
  // compare still runs to keep the access pattern uniform regardless of row
  // shape. Cheap; rejects malformed DB rows too.
  const a = Buffer.from(row.keyHash)
  const b = Buffer.from(hash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  // Best-effort last-used update; never block the request on it.
  db.update(extensionKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(extensionKeys.id, row.id))
    .catch(() => { /* swallow — observability, not auth */ })

  return { id: row.id, name: row.name, createdBy: row.createdBy }
}