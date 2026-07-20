import { desc } from 'drizzle-orm'
import { db } from '../../../../../utils/db'
import { aiProviders } from '../../../../../schema'
import { defineAdminHandler } from '../../../../../platform/http/auth'
import { getSettings } from '../../../../../utils/settings'
import { maskApiKey } from '../../../../../lib/ai/config'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/admin/ai/providers', summary: 'List AI providers (api keys masked)' },
  handler: async () => {
    // SECURITY: never select/return the plaintext api_key — masked preview only.
    const rows = await db.select({
      id: aiProviders.id,
      name: aiProviders.name,
      endpoint: aiProviders.endpoint,
      model: aiProviders.model,
      apiKey: aiProviders.apiKey,
      enabled: aiProviders.enabled,
      createdAt: aiProviders.createdAt,
      updatedAt: aiProviders.updatedAt,
    })
      .from(aiProviders)
      .orderBy(desc(aiProviders.createdAt))
      .limit(100)

    const settings = await getSettings()
    // Same precedence as refreshAiConfig: explicit DB toggle wins, env fallback.
    const toggle = settings.ai_tag_processing_enabled
    const tagProcessing = toggle !== undefined
      ? toggle === 'true'
      : process.env.ENABLE_AI_TAG_PROCESSING === 'true'

    return {
      tag_processing: tagProcessing,
      providers: rows.map(r => ({
        id: r.id,
        name: r.name,
        endpoint: r.endpoint,
        model: r.model,
        api_key_masked: maskApiKey(r.apiKey),
        enabled: r.enabled,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    }
  },
})
