/**
 * JobQueue 接口（ADR-0001）。
 *
 * 定义 enqueue / getStatus / consume / retry 四操作。默认 Redis 实现包装
 * 现有 queue.ts 语义（kura:jobs / kura:results: / kura:job_status:），行为
 * 一字不变。pg-boss 实现在 R2.5 收编 AI job + 定时器时接入。
 *
 * 不动（ADR-0001 §3）：kura:jobs → sidecar 的 Redis 桥；kura:results: /
 * kura:job_status: 结果回取协议及其 TTL/字面量语义；pipeline-worker 对
 * kura:pending_results 的 BRPOP。
 */
import type { SidecarJob, PipelineResult } from '../utils/queue'

export interface JobQueue {
  /** 入队，返回 jobId */
  enqueue(job: Omit<SidecarJob, 'id'>): Promise<string>
  /** 查询 job 状态字面量（queued / in_progress / done / error） */
  getStatus(jobId: string): Promise<string | null>
  /** 阻塞消费（BRPOP），对每个 jobId 调 handler */
  consume(handler: (jobId: string) => Promise<void>): Promise<void>
  /** 重试或进 DLQ；retryCount 从 0 起，达到上限推 kura:dlq */
  retry(jobId: string, retryCount: number, error: string): Promise<void>
}

export const MAX_RETRIES = 3
export const DLQ_KEY = 'kura:dlq'

/**
 * Redis 实现 — 包装现有 queue.ts 语义。
 *
 * enqueue 复用 enqueueJob（LPUSH kura:jobs）；getStatus 读 kura:job_status:；
 * consume 做对 kura:pending_results 的 BRPOP 循环；retry 在 DLQ 里记录失败 job。
 */
import { redis } from '../utils/redis'
import { enqueueJob } from '../utils/queue'

export const redisQueue: JobQueue = {
  async enqueue(job) {
    return enqueueJob(job)
  },

  async getStatus(jobId) {
    return redis.get(`kura:job_status:${jobId}`)
  },

  async consume(handler) {
    const { getBlockingRedis } = await import('../utils/redis')
    const blockRedis = await getBlockingRedis()
    while (true) {
      const result = await (blockRedis as any).BRPOP('kura:pending_results', 0)
      if (!result) continue
      const jobId = Array.isArray(result) ? result[1]
        : typeof result === 'string' ? result
        : (result as any)?.element
      if (!jobId) continue
      await handler(jobId)
    }
  },

  async retry(jobId, retryCount, error) {
    if (retryCount < MAX_RETRIES) {
      // Exponential backoff: 1s, 2s, 4s
      const delay = 1000 * Math.pow(2, retryCount)
      await new Promise(r => setTimeout(r, delay))
      return
    }
    // Max retries exhausted — push to DLQ
    await (redis as any).lpush(DLQ_KEY, JSON.stringify({
      jobId,
      error,
      failedAt: new Date().toISOString(),
      retryCount,
    }))
    console.error(`[queue] job ${jobId} exhausted ${MAX_RETRIES} retries → DLQ`)
  },
}
