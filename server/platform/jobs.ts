/**
 * pg-boss 单点注册（ADR-0001 §4）。
 *
 * 全部命名任务在此注册：AI job worker + 定时任务。
 * pg-boss 初始化在 08-pg-boss.ts Nitro 插件中调用 registerJobs()。
 *
 * 实施注意（spike/pg-boss/README.md）：
 * - v12 worker 回调是批量签名 async ([job]) => {}
 * - DLQ 必须先建：createQueue(name, { deadLetter }) 要求死信队列已存在
 * - cron 有 60s singleton 下限（5min/1h 产线节奏无影响）
 * - 死信是"复制"（新 id），原 job 留 failed
 */
import { PgBoss } from 'pg-boss'
import { sql } from 'drizzle-orm'
import { db } from '../utils/db'
import { classifyTags } from '../modules/ai/classify'
import { suggestMerges } from '../modules/ai/merges'
import { suggestRatings } from '../modules/ai/ratings'
import { updateAiJobProgress, completeAiJob } from '../modules/ai/jobs'

let _boss: PgBoss | null = null

export async function getBoss(): Promise<PgBoss> {
  if (!_boss) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL required for pg-boss')
    _boss = new PgBoss({ connectionString: url })
    await _boss.start()
  }
  return _boss
}

export async function registerJobs(boss: PgBoss) {
  // ── AI jobs (with DLQ) ──
  await boss.createQueue('ai-dlq')
  await boss.createQueue('ai-classify', { deadLetter: 'ai-dlq' })
  await boss.createQueue('ai-merges', { deadLetter: 'ai-dlq' })
  await boss.createQueue('ai-ratings', { deadLetter: 'ai-dlq' })

  await boss.work('ai-classify', async ([job]) => {
    if (!job) return
    const { jobId, tagNames } = job.data as { jobId: string; tagNames: string[] }
    const errors: string[] = []
    let classifications: Awaited<ReturnType<typeof classifyTags>> = []
    const batchSize = 25
    for (let i = 0; i < tagNames.length; i += batchSize) {
      try {
        const batch = tagNames.slice(i, i + batchSize)
        const partial = await classifyTags(batch)
        classifications.push(...partial)
      } catch (e: any) {
        errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${e?.message || String(e)}`)
      }
      await updateAiJobProgress(jobId, {
        done: Math.min(i + batchSize, tagNames.length),
        errors: errors.length ? errors : undefined,
      })
    }
    const suggestions = classifications.map(c => ({
      tag_name: c.name, category: c.category, translation: c.translation,
      danbooru_name: c.danbooru_name, confidence: c.confidence,
    }))
    await completeAiJob(jobId, { suggestions }, errors.length > 0)
  })

  await boss.work('ai-merges', async ([job]) => {
    if (!job) return
    const { jobId, scope } = job.data as { jobId: string; scope: any }
    const errors: string[] = []
    let groups: Awaited<ReturnType<typeof suggestMerges>> = []
    try {
      groups = await suggestMerges(scope)
      await updateAiJobProgress(jobId, { done: 1 })
    } catch (e: any) {
      errors.push(e?.message || String(e))
      await updateAiJobProgress(jobId, { errors })
    }
    await completeAiJob(jobId, { suggestions: groups }, errors.length > 0)
  })

  await boss.work('ai-ratings', async ([job]) => {
    if (!job) return
    const { jobId, scope, limit } = job.data as { jobId: string; scope: any; limit: number }
    const errors: string[] = []
    let results: Awaited<ReturnType<typeof suggestRatings>> = []
    try {
      results = await suggestRatings(scope, limit, (examined, total) => {
        updateAiJobProgress(jobId, { done: examined, total })
      })
    } catch (e: any) {
      errors.push(e?.message || String(e))
      await updateAiJobProgress(jobId, { errors })
    }
    await completeAiJob(jobId, { suggestions: results }, errors.length > 0)
  })

  // ── Scheduled jobs (setInterval → boss.schedule) ──
  await boss.schedule('dashboard-refresh', '*/5 * * * *')
  await boss.work('dashboard-refresh', async () => {
    try {
      await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats`)
    } catch (err) {
      console.warn('[dashboard-mv] refresh failed:', (err as Error).message)
    }
  })

  await boss.schedule('sync-tasks', '0 * * * *')
  await boss.work('sync-tasks', async () => {
    try {
      await db.execute(sql`
        UPDATE tags SET post_count = (
          SELECT COUNT(*) FROM post_tags WHERE post_tags.tag_id = tags.id
        )
      `)
      console.log('[sync] tag post_count reconciled')
    } catch (err) {
      console.error('[sync] tag post_count failed:', err)
    }
  })

  console.log('[pg-boss] jobs registered: ai-classify, ai-merges, ai-ratings, dashboard-refresh, sync-tasks')
}
