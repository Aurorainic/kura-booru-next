import { eq, and, isNull } from 'drizzle-orm'
import { extensionKeys } from '../../../../schema'
import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'delete', path: '/api/admin/extension-keys/:id', summary: 'Revoke extension key' },
  handler: async ({ event }) => {
    const id = event.context.params?.id as string
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'id required')

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
      throw new AppError('NOT_FOUND', 404, 'Key not found or already revoked')
    }

    return { ok: true, id: updated.id, revokedAt: updated.revokedAt }
  },
})
