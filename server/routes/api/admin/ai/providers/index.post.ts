import { db } from '../../../../../utils/db'
import { aiProviders } from '../../../../../schema'
import { defineAdminHandler } from '../../../../../platform/http/auth'
import { AppError } from '../../../../../platform/errors'
import { refreshAiConfig, maskApiKey } from '../../../../../lib/ai/config'

function validateEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new AppError('VALIDATION_FAILED', 400, 'endpoint 必须是合法 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('VALIDATION_FAILED', 400, 'endpoint 必须是 http(s) URL')
  }
  return trimmed
}

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/ai/providers', summary: 'Create AI provider' },
  handler: async ({ event }) => {
    const body = await readBody<{
      name?: string; endpoint?: string; model?: string; apiKey?: string; enabled?: boolean
    }>(event)

    const name = String(body?.name || '').trim()
    if (!name || name.length > 64) {
      throw new AppError('VALIDATION_FAILED', 400, 'name required (1-64 chars)')
    }
    const endpoint = validateEndpoint(String(body?.endpoint || ''))
    const model = String(body?.model || '').trim()
    if (!model || model.length > 128) {
      throw new AppError('VALIDATION_FAILED', 400, 'model required (1-128 chars)')
    }
    const apiKey = String(body?.apiKey || '').trim()
    if (!apiKey) {
      throw new AppError('VALIDATION_FAILED', 400, 'apiKey required')
    }
    const enabled = body?.enabled === true

    // Single active provider: enabling the new row disables all others.
    if (enabled) {
      await db.update(aiProviders).set({ enabled: false })
    }

    const [row] = await db.insert(aiProviders).values({
      name, endpoint, model, apiKey, enabled,
    }).returning()

    if (!row) throw new AppError('INTERNAL', 500, 'Insert failed')

    await refreshAiConfig()

    // Never echo the plaintext key back.
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
