/**
 * pg-boss 单点注册（ADR-0001 §4）。
 *
 * 全部命名任务在此注册：AI job worker + 定时任务。
 * pg-boss 初始化在 08-pg-boss.ts Nitro 插件中调用 registerJobs()。
 *
 * 实施注意（源自 pg-boss 技术验证结论，验证代码已随仓库清理移除）：
 * - v12 worker 回调是批量签名 async ([job]) => {}
 * - DLQ 必须先建：createQueue(name, { deadLetter }) 要求死信队列已存在
 * - cron 有 60s singleton 下限（5min/1h 产线节奏无影响）
 * - 死信是"复制"（新 id），原 job 留 failed
 */
import { PgBoss } from 'pg-boss'
import { sql } from 'drizzle-orm'
import { db } from '../utils/db'
import { classifyTags } from '../lib/ai/classify'
import { suggestMerges } from '../lib/ai/merges'
import { suggestRatings } from '../lib/ai/ratings'
import { updateAiJobProgress, completeAiJob } from '../lib/ai/jobs'
import { isAiEnabled, onAiConfigChanged } from '../lib/ai/config'

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

// ── AI worker 动态注册/注销 ──
// 按需启用原则：AI 关闭时不注册任何 AI worker（work() 每个队列都会常驻轮询，
// 占用 DB 连接与 CPU）。启用时注册，关闭时 offWork 释放。isAiEnabled() 的
// 快照在 admin 增删改 Provider / 切换全局开关后由 refreshAiConfig 更新，
// 并通过 onAiConfigChanged 钩子触发这里同步。
let aiWorkersRegistered = false

const AI_WORKER_QUEUES = ['ai-classify', 'ai-merges', 'ai-ratings'] as const

async function registerAiWorkers(boss: PgBoss) {
  if (aiWorkersRegistered) return

  // DLQ 必须先建：createQueue(name, { deadLetter }) 要求死信队列已存在
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

  aiWorkersRegistered = true
  console.log('[pg-boss] ai workers registered (ai enabled)')
}

async function unregisterAiWorkers(boss: PgBoss) {
  if (!aiWorkersRegistered) return
  for (const q of AI_WORKER_QUEUES) {
    try { await boss.offWork(q) } catch (err) {
      console.warn(`[pg-boss] offWork ${q} failed (non-fatal):`, err)
    }
  }
  aiWorkersRegistered = false
  console.log('[pg-boss] ai workers unregistered (ai disabled)')
}

/** 按当前 AI 启用状态对齐 worker 注册（启动 + AI 配置热刷新时调用）。 */
export async function syncAiWorkers(): Promise<void> {
  const boss = await getBoss()
  if (isAiEnabled()) await registerAiWorkers(boss)
  else await unregisterAiWorkers(boss)
}

export async function registerJobs(boss: PgBoss) {
  // ── AI jobs (with DLQ) ── 仅在 AI 启用时注册 worker；配置变化时同步。
  await syncAiWorkers()
  onAiConfigChanged(() => syncAiWorkers())

  // ── Scheduled jobs (setInterval → boss.schedule) ──
  // createQueue 必须先于 schedule：schedule 有 FK 约束，队列不存在会抛 Queue X not found
  await boss.createQueue('dashboard-refresh')
  await boss.schedule('dashboard-refresh', '*/5 * * * *')
  await boss.work('dashboard-refresh', async () => {
    try {
      await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats`)
    } catch (err) {
      console.warn('[dashboard-mv] refresh failed:', (err as Error).message)
    }
  })

  await boss.createQueue('sync-tasks')
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
