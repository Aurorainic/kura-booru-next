// v0.9.0 R2.5: split from server/utils/ai.ts. AI job progress (Redis-backed, short TTL).

import { redis } from '../../utils/redis'
import type { AiJobStatus } from './types'

// ── AI job progress (Redis-backed, short TTL) ──
// ponytail: avoid new PG tables for transient progress state; Redis SETEX with
// 1800s TTL auto-cleans. On completion, set status=done and shrink TTL to 60s.

const AI_JOB_TTL_RUNNING = 1800  // 30 min while running
const AI_JOB_TTL_DONE = 60       // 1 min after completion (lets polls settle)
const AI_JOB_KEY = (id: string) => `kura:ai_job:${id}`

export async function createAiJob(type: AiJobStatus['type'], total: number): Promise<string> {
  const id = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const status: AiJobStatus = {
    id, type, status: 'running', total, done: 0, errors: [], started_at: Date.now(),
  }
  await redis.set(AI_JOB_KEY(id), JSON.stringify(status), { EX: AI_JOB_TTL_RUNNING })
  return id
}

export async function updateAiJobProgress(id: string, patch: Partial<Pick<AiJobStatus, 'done' | 'errors' | 'total'>>): Promise<void> {
  try {
    const raw = await redis.get(AI_JOB_KEY(id))
    if (!raw) return  // expired or missing — silent
    const s = JSON.parse(raw) as AiJobStatus
    if (patch.done !== undefined) s.done = patch.done
    if (patch.total !== undefined) s.total = patch.total
    if (patch.errors) s.errors = [...s.errors, ...patch.errors].slice(-50)
    await redis.set(AI_JOB_KEY(id), JSON.stringify(s), { EX: AI_JOB_TTL_RUNNING })
  } catch (e) { console.error('[ai] updateAiJobProgress failed:', e) }
}

export async function completeAiJob(id: string, result: any, hadErrors: boolean): Promise<void> {
  try {
    const raw = await redis.get(AI_JOB_KEY(id))
    const s: AiJobStatus = raw ? JSON.parse(raw) : {
      id, type: 'classify', status: 'done', total: 0, done: 0, errors: [], started_at: Date.now(),
    }
    s.status = hadErrors ? 'error' : 'done'
    s.result = result
    await redis.set(AI_JOB_KEY(id), JSON.stringify(s), { EX: AI_JOB_TTL_DONE })
  } catch (e) { console.error('[ai] completeAiJob failed:', e) }
}

export async function getAiJobStatus(id: string): Promise<AiJobStatus | null> {
  try {
    const raw = await redis.get(AI_JOB_KEY(id))
    if (!raw) return null
    return JSON.parse(raw) as AiJobStatus
  } catch { return null }
}
