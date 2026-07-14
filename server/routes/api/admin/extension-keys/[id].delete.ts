import { eq, and, isNull } from 'drizzle-orm'
import { extensionKeys } from '../../../../schema'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = event.context.params?.id as string
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  // ponytail: revoke = set revoked_at. We deliberately don't delete the row —
  // keeps an audit trail of which keys existed and when they were killed.
  // A unique constraint on (key_hash, revoked_at IS NULL) would prevent
  // re-issuing the same hash; we don't need that since each new key gets a
  // fresh random value, so the hash is naturally unique.
  const [updated] = await db.update(extensionKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(extensionKeys.id, id), isNull(extensionKeys.revokedAt)))
    .returning({ id: extensionKeys.id, revokedAt: extensionKeys.revokedAt })

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Key not found or already revoked' })
  }

  return { ok: true, id: updated.id, revokedAt: updated.revokedAt }
})