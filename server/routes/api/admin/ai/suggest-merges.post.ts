import { defineAdminHandler } from '../../../../platform/http/auth'
import { getBoss } from '../../../../platform/jobs'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/ai/suggest-merges', summary: 'AI merge suggestions' },
  handler: async ({ event }) => {
    const body = await readBody<{ scope: 'all' | { category: string } }>(event)
    const scope = body?.scope || 'all'
    const normalizedScope = typeof scope === 'object' && scope.category
      ? { category: scope.category as any }
      : 'all' as const

    // Merge scanning involves fetching up to 200 tags + one AI call. It's not
    // deterministic in duration, so we run it as a pg-boss background job.
    const jobId = await createAiJob('merges', 1)
    const boss = await getBoss()
    await boss.send('ai-merges', { jobId, scope: normalizedScope })

    setResponseStatus(event, 202)
    return { job_id: jobId, suggestions: [] as any[] }
  },
})
