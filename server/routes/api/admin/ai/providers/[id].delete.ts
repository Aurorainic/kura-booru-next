import { eq } from 'drizzle-orm'
import { db } from '../../../../../utils/db'
import { aiProviders } from '../../../../../schema'
import { defineAdminHandler } from '../../../../../platform/http/auth'
import { AppError } from '../../../../../platform/errors'
import { refreshAiConfig } from '../../../../../lib/ai/config'

export default defineAdminHandler({
  doc: { method: 'delete', path: '/api/admin/ai/providers/:id', summary: 'Delete AI provider' },
  handler: async ({ event }) => {
    const id = event.context.params?.id as string
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'id required')

    const [deleted] = await db.delete(aiProviders)
      .where(eq(aiProviders.id, id))
      .returning({ id: aiProviders.id })

    if (!deleted) throw new AppError('NOT_FOUND', 404, 'Provider not found')

    await refreshAiConfig()

    return { ok: true, id: deleted.id }
  },
})
