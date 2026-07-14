/**
 * Sliding-window rate limiter backed by Redis.
 *
 * Used for per-key API throttling. Fail-open on Redis errors (UX over strict
 * enforcement — these aren't security-critical paths, just abuse mitigation).
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
  } catch {
    // ponytail: fail-open. Redis hiccup shouldn't block legit extension users.
    return { ok: true, remaining: limit, resetSec: windowSec }
  }
}