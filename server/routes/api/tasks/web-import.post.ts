import { requireAdminOrExtensionKey } from '../../utils/auth-helpers'
import { rateLimit } from '../../utils/rate-limit'
import { redis } from '../../utils/redis'

const VALID_RATINGS = new Set(['safe', 'questionable', 'explicit'])

export default defineEventHandler(async (event) => {
  const auth = await requireAdminOrExtensionKey(event)

  // Per-key throttle: extension users capped at 60 imports/min (vs BACKEND_API_KEY
  // bot's 30/min via different path). Admin session is unmetered.
  if (auth.kind === 'extension') {
    const rl = await rateLimit(`ext:${auth.keyId}`, 60, 60)
    if (!rl.ok) {
      throw createError({
        statusCode: 429,
        statusMessage: `Rate limit exceeded. Resets in ${rl.resetSec}s.`,
      })
    }
  }

  const body = await readBody<{ urls?: string[]; force_rating?: string }>(event)
  if (!body?.urls?.length) throw createError({ statusCode: 400, statusMessage: 'urls required' })

  // ponytail: force_rating is gated by canForceRating (admin opts in at key
  // creation). Even when allowed, every use is appended to an audit log so
  // abuse is visible in Redis. Without the gate, any kb_ext_ holder could
  // downgrade explicit→safe for free. Admin sessions skip force_rating (they
  // go through normal auto-rating; manual override is in the admin UI).
  let forceRating: 'safe' | 'questionable' | 'explicit' | undefined
  if (auth.kind === 'extension' && body.force_rating && VALID_RATINGS.has(body.force_rating)) {
    const ctx = (event.context as any).extensionKey
    if (ctx?.canForceRating) {
      forceRating = body.force_rating as 'safe' | 'questionable' | 'explicit'
      // ponytail: best-effort audit trail. Fail-open on Redis error — would
      // rather allow a logged bypass than block legit imports if Redis hiccups.
      redis.lpush(
        'kura:ext_force_rating_audit',
        JSON.stringify({
          at: new Date().toISOString(),
          keyId: auth.keyId,
          keyName: ctx.name,
          rating: forceRating,
          urlCount: body.urls.length,
        }),
      ).catch(() => { /* swallow — observability, not auth */ })
      // Keep last 1000 entries (atomic trim via RPOP/LTRIM after push).
      redis.ltrim('kura:ext_force_rating_audit', 0, 999).catch(() => {})
    }
    // else: silently fall back to auto-rating — UI showed the option but key
    // isn't authorized. (Alternative: 403; silent skip is friendlier.)
  }

  const results = await Promise.all(body.urls.slice(0, 50).map(async (url) => {
    try {
      let host: string
      try { host = new URL(url).hostname }
      catch { return { status: 'error', url, error: 'invalid URL' } }
      if (await isPrivateHost(host)) return { status: 'error', url, error: 'private/reserved host' }
      const jobId = await enqueueJob({
        url,
        ...(forceRating ? { force_rating: forceRating } : {}),
      })
      return { task_id: jobId, status: 'queued' as const, url }
    } catch (e: any) {
      return { status: 'error' as const, url, error: e.message }
    }
  }))

  return { results }
})