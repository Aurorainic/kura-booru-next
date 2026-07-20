// v0.9.0 R2.5: split from server/utils/ai.ts. AI configuration + status.
// v0.9.0: AI config moved from env vars to DB (ai_providers table + settings KV).
//
// getAiConfig() stays SYNC so the existing callers (client.ts, ratings.ts,
// reprocess.ts, pipeline.ts, bot.ts) don't change signature. It returns a
// module-level snapshot that refreshAiConfig() loads from the DB at startup
// (server/plugins/06-ai-config.ts) and after every admin mutation. Before the
// first successful refresh the snapshot falls back to the env vars, so cold
// start behaves exactly like the old env-based config.

import { eq } from 'drizzle-orm'
import { db } from '../../utils/db'
import { aiProviders } from '../../schema/ai_providers'
import { getSettings } from '../../utils/settings'

export interface AiConfig {
  enabled: boolean
  apiKey?: string
  endpoint?: string
  model?: string
  configured: boolean
}

function envSnapshot(): AiConfig {
  const enabled = process.env.ENABLE_AI_TAG_PROCESSING === 'true'
  const apiKey = process.env.AI_PROVIDER_API_KEY
  const endpoint = process.env.AI_PROVIDER_ENDPOINT
  const model = process.env.AI_PROVIDER_MODEL
  return { enabled, apiKey, endpoint, model, configured: !!(apiKey && endpoint && model) }
}

let snapshot: AiConfig = envSnapshot()
let seededFromEnv = false

export function getAiConfig(): AiConfig {
  return snapshot
}

export function isAiEnabled(): boolean {
  const cfg = getAiConfig()
  return cfg.enabled && cfg.configured
}

export function getAiStatus() {
  const cfg = getAiConfig()
  return {
    enabled: cfg.enabled && cfg.configured,
    endpoint: cfg.endpoint ? cfg.endpoint.replace(/\/$/, '') : null,
    model: cfg.model || null,
  }
}

/**
 * Reload the snapshot from the DB: enabled provider row + global
 * `ai_tag_processing_enabled` settings toggle. On failure the previous
 * snapshot is kept (never wedge the pipeline on a transient DB error).
 */
export async function refreshAiConfig(): Promise<AiConfig> {
  try {
    await seedAiProviderFromEnv()

    const [provider] = await db.select().from(aiProviders)
      .where(eq(aiProviders.enabled, true))
      .limit(1)

    const settings = await getSettings()
    // Toggle precedence: explicit DB setting wins; when the key has never been
    // written, fall back to the env var so existing deployments keep working.
    const toggle = settings.ai_tag_processing_enabled
    const tagProcessing = toggle !== undefined
      ? toggle === 'true'
      : process.env.ENABLE_AI_TAG_PROCESSING === 'true'

    snapshot = provider
      ? {
          enabled: tagProcessing,
          apiKey: provider.apiKey,
          endpoint: provider.endpoint,
          model: provider.model,
          configured: !!(provider.apiKey && provider.endpoint && provider.model),
        }
      : { enabled: tagProcessing, apiKey: undefined, endpoint: undefined, model: undefined, configured: false }
  } catch (e) {
    // e.g. migration 0007 not applied yet — env snapshot stays active.
    console.warn('[ai-config] refresh failed, keeping previous snapshot:', e)
  }
  return snapshot
}

/** First-run seed: import AI_PROVIDER_* env vars as a provider row when the table is empty. */
async function seedAiProviderFromEnv() {
  if (seededFromEnv) return
  seededFromEnv = true
  const endpoint = process.env.AI_PROVIDER_ENDPOINT
  const model = process.env.AI_PROVIDER_MODEL
  const apiKey = process.env.AI_PROVIDER_API_KEY
  if (!endpoint || !model || !apiKey) return

  const existing = await db.select({ id: aiProviders.id }).from(aiProviders).limit(1)
  if (existing.length > 0) return

  await db.insert(aiProviders).values({
    name: 'env-seed',
    endpoint,
    model,
    apiKey,
    enabled: true,
  })
  console.log('[ai-config] Seeded AI provider from AI_PROVIDER_* env vars')
}

/**
 * Mask an API key for display. Plaintext keys must never appear in any API
 * response — admin GET endpoints return this preview only.
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
