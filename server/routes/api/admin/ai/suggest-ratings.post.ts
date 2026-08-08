import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'
import { getBoss } from '../../../../platform/jobs'
import { isAiEnabled } from '../../../../lib/ai/config'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/ai/suggest-ratings', summary: 'AI rating suggestions' },
  handler: async ({ event }) => {
    // 按需启用原则：AI 关闭时拒绝入队（worker 未注册，job 会积压）。
    if (!isAiEnabled()) {
      throw new AppError('FEATURE_DISABLED', 409, 'AI 功能未启用')
    }

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
    // with 200ms delay). Run as a pg-boss job; client polls GET /jobs/:id.
    const jobId = await createAiJob('ratings', limit)
    const boss = await getBoss()
    await boss.send('ai-ratings', { jobId, scope: normalizedScope, limit })

    setResponseStatus(event, 202)
    return { job_id: jobId, suggestions: [] as any[] }
  },
})
