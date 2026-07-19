// v0.9.0 R2.5: split from server/utils/ai.ts. AI configuration + status.

// ── Config ──

export function getAiConfig() {
  const enabled = process.env.ENABLE_AI_TAG_PROCESSING === 'true'
  const apiKey = process.env.AI_PROVIDER_API_KEY
  const endpoint = process.env.AI_PROVIDER_ENDPOINT
  const model = process.env.AI_PROVIDER_MODEL
  return { enabled, apiKey, endpoint, model, configured: !!(apiKey && endpoint && model) }
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
