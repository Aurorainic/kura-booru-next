import { inArray, isNull, and, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ mode: 'unprocessed' | 'all' | 'specific'; tag_ids?: string[] }>(event)
  const mode = body?.mode || 'unprocessed'

  // ponytail: specific mode is short (≤ tag_ids.length) — keep synchronous,
  // return suggestions directly. unprocessed/all can hit 100 tags → run async.
  if (mode === 'specific' && body?.tag_ids?.length) {
    const tagRows = await db.select().from(tags)
      .where(and(inArray(tags.id, body.tag_ids!), sql`${tags.category} != 'artist'`))
    if (!tagRows.length) return { suggestions: [] }
    const classifications = await classifyTags(tagRows.map(t => t.name))
    return {
      suggestions: classifications.map(c => ({
        tag_name: c.name,
        category: c.category,
        translation: c.translation,
        danbooru_name: c.danbooru_name,
        confidence: c.confidence,
      })),
    }
  }

  // For unprocessed / all — fire-and-forget background job; return job_id for polling.
  const conditions = []
  if (mode === 'unprocessed') conditions.push(isNull(tags.aiProcessedAt))
  conditions.push(sql`${tags.category} != 'artist'`)
  const where = conditions.length ? and(...conditions) : undefined
  const tagRows = await db.select().from(tags).where(where).limit(100)

  if (!tagRows.length) return { suggestions: [], job_id: null }

  const jobId = await createAiJob('classify', tagRows.length)
  // Background task — runs after the response is sent. Errors are recorded
  // in the job status rather than propagated to the caller.
  event.waitUntil((async () => {
    const errors: string[] = []
    let classifications: Awaited<ReturnType<typeof classifyTags>> = []
    try {
      classifications = await classifyTags(tagRows.map(t => t.name))
      await updateAiJobProgress(jobId, { done: classifications.length })
    } catch (e: any) {
      errors.push(e?.message || String(e))
      await updateAiJobProgress(jobId, { errors })
    }
    const suggestions = classifications.map(c => ({
      tag_name: c.name,
      category: c.category,
      translation: c.translation,
      danbooru_name: c.danbooru_name,
      confidence: c.confidence,
    }))
    await completeAiJob(jobId, { suggestions }, errors.length > 0)
  })())

  setResponseStatus(event, 202)
  return { job_id: jobId, suggestions: [] as any[] }
})
