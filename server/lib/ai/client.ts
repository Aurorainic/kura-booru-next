// v0.9.0 R2.5: split from server/utils/ai.ts. OpenAI-compatible API client.

import { getAiConfig } from './config'
import type { AiMessage } from './types'

// ── Custom Error class ──

class AiError extends Error {
  statusCode?: number
  retriable?: boolean
  constructor(message: string, opts?: { statusCode?: number; retriable?: boolean; cause?: unknown }) {
    super(message, opts?.cause ? { cause: opts.cause } : undefined)
    this.name = 'AiError'
    this.statusCode = opts?.statusCode
    this.retriable = opts?.retriable
  }
}

// ── Core API call ──

const AI_TIMEOUT_MS = 30_000
const AI_MAX_RETRIES = 2

function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function callAiOnce(messages: AiMessage[], opts?: { json?: boolean; temperature?: number }, signal?: AbortSignal): Promise<string> {
  const cfg = getAiConfig()
  if (!cfg.enabled || !cfg.configured) {
    throw new AiError('AI not configured', { statusCode: 503 })
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
    throw new AiError(`AI API ${resp.status}: ${text.slice(0, 200)}`, {
      statusCode: resp.status,
      retriable: isRetriableStatus(resp.status),
    })
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

/**
 * 从 AI 原始输出中稳健地提取 JSON。
 *
 * 部分模型（尤其 deepseek 等）即使开了 response_format，也可能把 JSON
 * 包在 ```json ... ``` 代码围栏里，或前后加闲聊文字。JSON.parse 直接失败
 * 会让整个批次作废。这里先剥围栏、再截取首个平衡的 {...} 区间。
 */
export function extractJsonFromRaw(raw: string): unknown {
  let text = (raw || '').trim()
  // 剥掉 ```json ... ``` 围栏
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/)
  if (fence?.[1]) text = fence[1].trim()

  // 若剥围栏后仍非纯 JSON，尝试截取第一个平衡的 {...}
  if (!text.startsWith('{')) {
    const start = text.indexOf('{')
    if (start === -1) throw new Error('AI 输出中未找到 JSON 对象')
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escape) escape = false
        else if (ch === '\\') escape = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) { text = text.slice(start, i + 1); break } }
    }
  }
  return JSON.parse(text)
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
