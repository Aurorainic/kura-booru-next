import { requireAdminOrExtensionKey } from '../../utils/auth-helpers'
import { rateLimit } from '../../utils/rate-limit'

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

  // force_rating is restricted to the extension key path — only then do we trust
  // the caller enough to bypass auto-rating. Admin sessions go through the normal
  // pipeline; they can manually edit post rating via the admin UI after import.
  const forceRating = auth.kind === 'extension'
    && body.force_rating
    && VALID_RATINGS.has(body.force_rating)
    ? body.force_rating as 'safe' | 'questionable' | 'explicit'
    : undefined

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