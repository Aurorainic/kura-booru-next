export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

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
      results = await suggestRatings(normalizedScope, limit)
      await updateAiJobProgress(jobId, { done: results.length, total: limit })
    } catch (e: any) {
      errors.push(e?.message || String(e))
      await updateAiJobProgress(jobId, { errors })
    }
    await completeAiJob(jobId, { suggestions: results }, errors.length > 0)
  })())

  setResponseStatus(event, 202)
  return { job_id: jobId, suggestions: [] as any[] }
})
