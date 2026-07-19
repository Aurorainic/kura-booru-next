import { defineAdminHandler } from '../../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/ai/suggest-ratings', summary: 'AI rating suggestions' },
  handler: async ({ event }) => {
    const body = await readBody<{ scope: 'unrated' | 'all' | { rating: string }; limit?: number }>(event)
    const scope = body?.scope || 'unrated'
    const limit = Math.min(body?.limit || 50, 100)

    let normalizedScope: 'unrated' | 'all' | { rating: any }
    if (typeof scope === 'object' && scope.rating) {
      normalizedScope = { rating: scope.rating as any }
    } else {
      normalizedScope = (scope as 'unrated' | 'all') || 'unrated'
    }

    // Rating suggestions are inherently slow (one AI call per post, sequential
    // with 200ms delay). Run as a background job; client polls GET /jobs/:id.
    const jobId = await createAiJob('ratings', limit)
    event.waitUntil((async () => {
      const errors: string[] = []
      let results: Awaited<ReturnType<typeof suggestRatings>> = []
      try {
        results = await suggestRatings(normalizedScope, limit, (examined, total) => {
          // Per-post incremental progress — the old code only updated once at
          // the end with results.length, so progress sat at 0 until completion.
          updateAiJobProgress(jobId, { done: examined, total })
        })
      } catch (e: any) {
        errors.push(e?.message || String(e))
        await updateAiJobProgress(jobId, { errors })
      }
      await completeAiJob(jobId, { suggestions: results }, errors.length > 0)
    })())

    setResponseStatus(event, 202)
    return { job_id: jobId, suggestions: [] as any[] }
  },
})
