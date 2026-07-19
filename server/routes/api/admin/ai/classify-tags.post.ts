import { inArray, isNull, and, sql } from 'drizzle-orm'
import { defineAdminHandler } from '../../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/ai/classify-tags', summary: 'AI tag classification' },
  handler: async ({ event }) => {
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
        // classifyTags internally batches in chunks of 25; report progress
        // per chunk so the UI shows incremental advancement instead of a
        // single 0 -> 100 jump at the end.
        const allNames = tagRows.map(t => t.name)
        const batchSize = 25
        classifications = []
        for (let i = 0; i < allNames.length; i += batchSize) {
          const batch = allNames.slice(i, i + batchSize)
          try {
            const partial = await classifyTags(batch)
            classifications.push(...partial)
          } catch (e: any) {
            errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${e?.message || String(e)}`)
          }
          await updateAiJobProgress(jobId, {
            done: Math.min(i + batchSize, allNames.length),
            errors: errors.length ? errors : undefined,
          })
        }
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
  },
})
