// v0.9.0 R2.5: split from server/utils/ai.ts. OpenAI-compatible API client.

import { getAiConfig } from './config'
import type { AiMessage } from './types'

// ── Core API call ──

const AI_TIMEOUT_MS = 30_000
const AI_MAX_RETRIES = 2

function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function callAiOnce(messages: AiMessage[], opts?: { json?: boolean; temperature?: number }, signal?: AbortSignal): Promise<string> {
  const cfg = getAiConfig()
  if (!cfg.enabled || !cfg.configured) {
    throw Object.assign(new Error('AI not configured'), { statusCode: 503 })
  }

  const baseEndpoint = cfg.endpoint!.replace(/\/$/, '')
  const url = `${baseEndpoint}/chat/completions`

  const body: Record<string, any> = {
    model: cfg.model,
    messages,
    temperature: opts?.temperature ?? 0.3,
  }
  if (opts?.json) {
    body.response_format = { type: 'json_object' }
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`AI API ${resp.status}: ${text.slice(0, 200)}`)
    Object.assign(err, { statusCode: resp.status, retriable: isRetriableStatus(resp.status) })
    throw err
  }

  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI API returned empty response')
  return content
}

export interface AiConnectionTestResult {
  ok: boolean
  latencyMs: number
  error?: string
}

const TEST_TIMEOUT_MS = 15_000

/**
 * Test an explicit provider config with a minimal chat completion.
 * Used by the admin "测试连接" button — does NOT touch the global snapshot,
 * so unsaved form payloads can be tested too. Single attempt, no retries.
 */
export async function testAiConnection(cfg: { endpoint: string; model: string; apiKey: string }): Promise<AiConnectionTestResult> {
  const baseEndpoint = cfg.endpoint.replace(/\/$/, '')
  const url = `${baseEndpoint}/chat/completions`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  const started = Date.now()
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'Reply with: OK' }],
        max_tokens: 4,
        temperature: 0,
      }),
      signal: controller.signal,
    })
    const latencyMs = Date.now() - started
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return { ok: false, latencyMs, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` }
    }
    const data = await resp.json()
    const content = data?.choices?.[0]?.message?.content
    if (content === undefined || content === null) {
      return { ok: false, latencyMs, error: 'API 返回了空响应' }
    }
    return { ok: true, latencyMs }
  } catch (e: any) {
    const latencyMs = Date.now() - started
    const msg = e?.name === 'AbortError' ? `连接超时（>${TEST_TIMEOUT_MS / 1000}s）` : (e?.message || String(e))
    return { ok: false, latencyMs, error: msg }
  } finally {
    clearTimeout(timeout)
  }
}

export async function callAi(messages: AiMessage[], opts?: { json?: boolean; temperature?: number }): Promise<string> {
  let lastErr: any
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
    try {
      return await callAiOnce(messages, opts, controller.signal)
    } catch (e: any) {
      lastErr = e
      const retriable = e?.retriable || e?.name === 'AbortError' || (e?.code && !e.statusCode)
      if (!retriable || attempt === AI_MAX_RETRIES) throw e
      // Exponential backoff: base 1s * 2^attempt, ±20% jitter
      const base = 1000 * Math.pow(2, attempt)
      const jitter = base * (0.8 + Math.random() * 0.4)
      await new Promise(r => setTimeout(r, jitter))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastErr
}
