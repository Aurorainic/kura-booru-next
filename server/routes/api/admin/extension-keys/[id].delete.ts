import { eq, and, isNull } from 'drizzle-orm'
import { extensionKeys } from '../../../../schema'
import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'delete', path: '/api/admin/extension-keys/:id', summary: 'Revoke extension key' },
  handler: async ({ event }) => {
    const id = event.context.params?.id as string
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'id required')

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
