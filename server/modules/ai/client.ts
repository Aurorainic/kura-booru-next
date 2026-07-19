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
