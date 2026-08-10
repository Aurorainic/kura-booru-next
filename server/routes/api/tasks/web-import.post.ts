import { defineExtHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { redis } from '../../../utils/redis'

const VALID_RATINGS = new Set(['safe', 'questionable', 'explicit'])

export default defineExtHandler({
  doc: { method: 'post', path: '/api/tasks/web-import', summary: 'Web import via extension key (frozen protocol)' },
  handler: async ({ event, auth }) => {
    const body = await readBody<{ urls?: string[]; force_rating?: string }>(event)
    if (!body?.urls?.length) throw new AppError('VALIDATION_FAILED', 400, 'urls required')
    if (!Array.isArray(body.urls) || body.urls.some((url) => typeof url !== 'string' || !url.trim())) {
      throw new AppError('VALIDATION_FAILED', 400, 'urls must be non-empty strings')
    }

    const requestedForceRating = auth.kind === 'extension'
      && body.force_rating
      && VALID_RATINGS.has(body.force_rating)
      ? body.force_rating as 'safe' | 'questionable' | 'explicit'
      : undefined
    const forceRatingBlocked = requestedForceRating !== undefined
      && !(auth.kind === 'extension' && auth.canForceRating)

    const forceRating = requestedForceRating && !forceRatingBlocked ? requestedForceRating : undefined

    if (forceRating && auth.kind === 'extension') {
      ;(redis as any).lpush(
        'kura:ext_force_rating_audit',
        JSON.stringify({
          at: new Date().toISOString(),
          keyId: auth.keyId,
          keyName: auth.keyName,
          rating: forceRating,
          urlCount: body.urls.length,
        }),
      ).catch(() => { /* swallow — observability, not auth */ })
      // Keep last 1000 entries (atomic trim via RPOP/LTRIM after push).
      ;(redis as any).ltrim('kura:ext_force_rating_audit', 0, 999).catch(() => {})
    }

    const results = await Promise.all(body.urls.slice(0, 50).map(async (url) => {
      try {
        let parsed: URL
        try { parsed = new URL(url) }
        catch { return { status: 'error', url, error: 'invalid URL' } }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { status: 'error', url, error: 'unsupported protocol' }
        }
        const host = parsed.hostname
        if (await isPrivateHost(host)) return { status: 'error', url, error: 'private/reserved host' }

        if (forceRatingBlocked) {
          return { status: 'error', url, error: 'key_not_authorized_for_force_rating' }
        }

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
  },
})
