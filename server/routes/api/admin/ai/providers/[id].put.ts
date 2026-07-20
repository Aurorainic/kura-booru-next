import { eq } from 'drizzle-orm'
import { db } from '../../../../../utils/db'
import { aiProviders } from '../../../../../schema'
import { defineAdminHandler } from '../../../../../platform/http/auth'
import { AppError } from '../../../../../platform/errors'
import { refreshAiConfig, maskApiKey } from '../../../../../lib/ai/config'

export default defineAdminHandler({
  doc: { method: 'put', path: '/api/admin/ai/providers/:id', summary: 'Update AI provider' },
  handler: async ({ event }) => {
    const id = event.context.params?.id as string
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'id required')

    const body = await readBody<{
      name?: string; endpoint?: string; model?: string; apiKey?: string; enabled?: boolean
    }>(event)

    const [existing] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1)
    if (!existing) throw new AppError('NOT_FOUND', 404, 'Provider not found')

    const updates: Partial<typeof aiProviders.$inferInsert> = { updatedAt: new Date() }

    if (body?.name !== undefined) {
      const name = String(body.name).trim()
      if (!name || name.length > 64) {
        throw new AppError('VALIDATION_FAILED', 400, 'name required (1-64 chars)')
      }
      updates.name = name
    }
    if (body?.endpoint !== undefined) {
      const endpoint = String(body.endpoint).trim().replace(/\/+$/, '')
      let url: URL
      try {
        url = new URL(endpoint)
      } catch {
        throw new AppError('VALIDATION_FAILED', 400, 'endpoint 必须是合法 URL')
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new AppError('VALIDATION_FAILED', 400, 'endpoint 必须是 http(s) URL')
      }
      updates.endpoint = endpoint
    }
    if (body?.model !== undefined) {
      const model = String(body.model).trim()
      if (!model || model.length > 128) {
        throw new AppError('VALIDATION_FAILED', 400, 'model required (1-128 chars)')
      }
      updates.model = model
    }
    // Empty apiKey means "keep existing" — the edit form never round-trips plaintext.
    if (typeof body?.apiKey === 'string' && body.apiKey.trim().length > 0) {
      updates.apiKey = body.apiKey.trim()
    }
    if (body?.enabled !== undefined) {
      updates.enabled = body.enabled === true
    }

    // Single active provider: enabling this row disables all others first.
    if (updates.enabled === true) {
      await db.update(aiProviders).set({ enabled: false })
    }

    const [row] = await db.update(aiProviders)
      .set(updates)
      .where(eq(aiProviders.id, id))
      .returning()

    if (!row) throw new AppError('NOT_FOUND', 404, 'Provider not found')

    await refreshAiConfig()

    return {
      id: row.id,
      name: row.name,
      endpoint: row.endpoint,
      model: row.model,
      api_key_masked: maskApiKey(row.apiKey),
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  },
})
