import { inArray, isNull, and, sql } from 'drizzle-orm'
import { defineAdminHandler } from '../../../../platform/http/auth'
import { getBoss } from '../../../../platform/jobs'

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

    // For unprocessed / all — enqueue pg-boss job; return job_id for polling.
    const conditions = []
    if (mode === 'unprocessed') conditions.push(isNull(tags.aiProcessedAt))
    conditions.push(sql`${tags.category} != 'artist'`)
    const where = conditions.length ? and(...conditions) : undefined
    const tagRows = await db.select().from(tags).where(where).limit(100)

    if (!tagRows.length) return { suggestions: [], job_id: null }

    const jobId = await createAiJob('classify', tagRows.length)
    // pg-boss handles job execution (ADR-0001). Progress is written to Redis
    // job status by the worker; jobs/[id].get reads from Redis (unchanged).
    const boss = await getBoss()
    await boss.send('ai-classify', { jobId, tagNames: tagRows.map(t => t.name) })

    setResponseStatus(event, 202)
    return { job_id: jobId, suggestions: [] as any[] }
  },
})
