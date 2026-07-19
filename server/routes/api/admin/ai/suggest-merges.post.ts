import { defineAdminHandler } from '../../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/ai/suggest-merges', summary: 'AI merge suggestions' },
  handler: async ({ event }) => {
    const body = await readBody<{ scope: 'all' | { category: string } }>(event)
    const scope = body?.scope || 'all'
    const normalizedScope = typeof scope === 'object' && scope.category
      ? { category: scope.category as any }
      : 'all' as const

    // Merge scanning involves fetching up to 200 tags + one AI call. It's not
    // deterministic in duration, so we run it as a background job.
    const jobId = await createAiJob('merges', 1)
    event.waitUntil((async () => {
      const errors: string[] = []
      let groups: Awaited<ReturnType<typeof suggestMerges>> = []
      try {
        groups = await suggestMerges(normalizedScope)
        await updateAiJobProgress(jobId, { done: 1 })
      } catch (e: any) {
        errors.push(e?.message || String(e))
        await updateAiJobProgress(jobId, { errors })
      }
      await completeAiJob(jobId, { suggestions: groups }, errors.length > 0)
    })())

    setResponseStatus(event, 202)
    return { job_id: jobId, suggestions: [] as any[] }
  },
})
