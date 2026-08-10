import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'
import { getBoss } from '../../../../platform/jobs'
import { isAiEnabled } from '../../../../lib/ai/config'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/ai/suggest-merges', summary: 'AI merge suggestions' },
  handler: async ({ event }) => {
    // 按需启用原则：AI 关闭时拒绝入队（worker 未注册，job 会积压）。
    if (!isAiEnabled()) {
      throw new AppError('FEATURE_DISABLED', 409, 'AI 功能未启用')
    }

    const body = await readBody<{ scope: 'all' | { category: string } }>(event)
    const scope = body?.scope || 'all'
    const normalizedScope = typeof scope === 'object' && scope.category
      ? { category: scope.category as any }
      : 'all' as const

    // Merge scanning fetches up to 200 tags + one AI call — not deterministic
    // in duration, so run as a pg-boss background job.
    const jobId = await createAiJob('merges', 1)
    const boss = await getBoss()
    await boss.send('ai-merges', { jobId, scope: normalizedScope })

    setResponseStatus(event, 202)
    return { job_id: jobId, suggestions: [] as any[] }
  },
})
