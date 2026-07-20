import { defineExtHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { redis } from '../../../utils/redis'

const VALID_RATINGS = new Set(['safe', 'questionable', 'explicit'])

export default defineExtHandler({
  doc: { method: 'post', path: '/api/tasks/web-import', summary: 'Web import via extension key (frozen protocol)' },
  handler: async ({ event, auth }) => {
    const body = await readBody<{ urls?: string[]; force_rating?: string }>(event)
    if (!body?.urls?.length) throw new AppError('VALIDATION_FAILED', 400, 'urls required')

    // ponytail: force_rating requires the key have canForceRating (admin opt-in
    // at key creation). Without it, we DON'T silently ignore the user's selection
    // — we surface it as per-URL error so the extension UI can show "this key
    // can't override rating" instead of pretending it worked. Admin sessions
    // skip force_rating (they go through normal auto-rating; manual override is
    // in the admin UI after import).
    const requestedForceRating = auth.kind === 'extension'
      && body.force_rating
      && VALID_RATINGS.has(body.force_rating)
      ? body.force_rating as 'safe' | 'questionable' | 'explicit'
      : undefined
    const forceRatingBlocked = requestedForceRating !== undefined
      && !(auth.kind === 'extension' && auth.canForceRating)

    const forceRating = requestedForceRating && !forceRatingBlocked ? requestedForceRating : undefined

    if (forceRating && auth.kind === 'extension') {
      // ponytail: best-effort audit trail. Fail-open on Redis error — would
      // rather allow a logged bypass than block legit imports if Redis hiccups.
      // Narrowed on auth.kind so TS sees keyId/keyName (only the extension
      // branch can produce a requestedForceRating anyway, but the if above
      // doesn't statically prove that — an explicit narrow keeps the audit
      // log clean and avoids the (admin path) ? `unknown` ? workaround).
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
        let host: string
        try { host = new URL(url).hostname }
        catch { return { status: 'error', url, error: 'invalid URL' } }
        if (await isPrivateHost(host)) return { status: 'error', url, error: 'private/reserved host' }

        // ponytail: per-URL rejection when key lacks force_rating cap. UI can
        // distinguish this from server errors and prompt the user to get an
        // admin to re-issue the key with can_force_rating=true.
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
