import { eq } from 'drizzle-orm'
import { db } from '../../../../../utils/db'
import { aiProviders } from '../../../../../schema'
import { defineAdminHandler } from '../../../../../platform/http/auth'
import { AppError } from '../../../../../platform/errors'
import { testAiConnection } from '../../../../../lib/ai/client'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/ai/providers/test', summary: 'Test AI provider connection' },
  handler: async ({ event }) => {
    const body = await readBody<{
      id?: string; endpoint?: string; model?: string; apiKey?: string
    }>(event)

    let endpoint = String(body?.endpoint || '').trim()
    let model = String(body?.model || '').trim()
    let apiKey = String(body?.apiKey || '').trim()

    // Saved provider: fill any missing fields from the stored row (the stored
    // plaintext key never leaves the server — the test call is server-side).
    if (body?.id) {
      const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, body.id)).limit(1)
      if (!row) throw new AppError('NOT_FOUND', 404, 'Provider not found')
      endpoint = endpoint || row.endpoint
      model = model || row.model
      apiKey = apiKey || row.apiKey
    }

    if (!endpoint || !model || !apiKey) {
      throw new AppError('VALIDATION_FAILED', 400, 'endpoint, model and apiKey required')
    }

    return await testAiConnection({ endpoint, model, apiKey })
  },
})
