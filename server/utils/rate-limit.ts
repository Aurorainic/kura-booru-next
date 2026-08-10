/**
 * Sliding-window rate limiter backed by Redis. Fail-open on Redis errors (abuse
 * mitigation, not security-critical enforcement).
 */
import { redis } from './redis'

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetSec: number
}

export async function rateLimit(bucket: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  try {
    const key = `rl:${bucket}`
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, windowSec)
    }
    const ttl = await redis.ttl(key)
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      resetSec: ttl > 0 ? ttl : windowSec,
    }
  } catch (e) {
    console.warn(`[rate-limit] Redis fail-open for bucket=${bucket}:`, (e as Error).message)
    return { ok: true, remaining: limit, resetSec: windowSec }
  }
}