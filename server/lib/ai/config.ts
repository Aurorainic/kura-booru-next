// v0.9.0 R2.5: split from server/utils/ai.ts. AI configuration + status.
// v0.9.0: AI config moved from env vars to DB (ai_providers + settings KV).
//
// getAiConfig() stays SYNC so existing callers keep their signatures. It returns
// a module-level snapshot that refreshAiConfig() loads from the DB at startup
// (06-ai-config.ts) and after every admin mutation; before the first successful
// refresh it falls back to env vars, so cold start matches the old env config.

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

// 启用状态变化时通知依赖方（jobs.ts 据此注册/注销 AI worker）— 回调避免
// config → jobs → ratings → config 循环依赖。
type AiConfigHook = () => void | Promise<void>
const aiConfigHooks: AiConfigHook[] = []

export function onAiConfigChanged(hook: AiConfigHook) {
  aiConfigHooks.push(hook)
}

async function fireAiConfigHooks() {
  for (const hook of aiConfigHooks) {
    try { await hook() } catch (err) {
      console.warn('[ai-config] change hook failed (non-fatal):', err)
    }
  }
}

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
    // Toggle precedence: explicit DB setting wins; unwritten key falls back to env.
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
    // Migration not applied yet — env snapshot stays active.
    console.warn('[ai-config] refresh failed, keeping previous snapshot:', e)
  }
  // 成败都触发钩子：失败时按旧 snapshot 幂等（不重复注册/注销）。
  await fireAiConfigHooks()
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
 * Mask an API key for display — plaintext keys must never appear in API
 * responses; admin GET endpoints return only this preview.
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
