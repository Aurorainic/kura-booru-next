import { eq } from 'drizzle-orm'
import { defineAdminHandler } from '../../../../../platform/http/auth'
import { AppError } from '../../../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'delete', path: '/api/admin/tags/aliases/:id', summary: 'Delete tag alias' },
  handler: async ({ event }) => {
    const id = event.context.params?.id as string
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'Alias ID required')

    const existing = await db.select().from(tagAliases).where(eq(tagAliases.id, id)).limit(1)
    if (!existing[0]) throw new AppError('NOT_FOUND', 404, 'Alias not found')

    await db.delete(tagAliases).where(eq(tagAliases.id, id))

    return { deleted: true }
  },
})
