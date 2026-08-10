import crypto from 'crypto'
import { redis } from './redis'
import { identifySource, resolveSourceOrOther } from './url-patterns'

export interface SidecarJob {
  id: string
  url: string
  source_site?: string
  source_id?: string
  // v0.7.8: if set, pipeline skips auto-rating and uses this verbatim.
  // Restricted to extension key auth path (admin web uses defaults).
  force_rating?: 'safe' | 'questionable' | 'explicit'
}

export interface SidecarPage {
  page_index: number
  image_bytes_b64: string
  phash: string
  width: number
  height: number
  mime_type: string
  file_size: number
}

export interface SidecarMetadata {
  width: number
  height: number
  mime_type: string
  file_size: number
  title?: string
  description?: string
  source_url: string
  source_site: string
  source_id: string
  tag_names: string[]
  artist_name?: string
  // v0.7.8 PR-C: multi-image Pixiv illust. When is_multi=true, the older
  // flat width/height/mime_type/file_size fields above are the *first* page's
  // values (kept for back-compat). Each page also carries its own phash +
  // dims so pipeline.ts can split into N rows sharing series_id.
  is_multi?: boolean
  page_count?: number
  pages?: SidecarPage[]
}

export interface SidecarResult {
  status: 'ok' | 'error' | 'too_large'
  image_bytes_b64?: string
  phash?: string
  error?: string
  max_size?: number
  metadata?: SidecarMetadata
}

/** Pipeline result — what the pipeline worker writes back after processing a sidecar result */
export interface PipelineResult {
  status: 'success' | 'duplicate' | 'too_large' | 'failed'
  post_id?: string
  source_site?: string
  source_id?: string
  auto_rating?: string
  existing_post_id?: string
  error?: string
}

export async function enqueueJob(job: Omit<SidecarJob, 'id'>): Promise<string> {
  const id = crypto.randomUUID()
  // Sidecar records source_site/source_id in metadata; callers with only a URL
  // (web import, extension) must not fall through to "other" for lack of them.
  const detected = identifySource(job.url) || resolveSourceOrOther(job.url)
  const payload = {
    id,
    ...job,
    source_site: job.source_site || detected.site,
    source_id: job.source_id || detected.id,
  }
  await (redis as any).lpush('kura:jobs', JSON.stringify(payload))
  const meta: Record<string, unknown> = {}
  if (job.force_rating) meta.force_rating = job.force_rating
  if (Object.keys(meta).length > 0) {
    await redis.set(`kura:job_meta:${id}`, JSON.stringify(meta), { EX: 3600 })
  }
  return id
}

export async function pollJobResult(jobId: string, timeoutMs = 300_000): Promise<PipelineResult | null> {
  const start = Date.now()
  const pollInterval = 500

  while (Date.now() - start < timeoutMs) {
    const status = await redis.get(`kura:job_status:${jobId}`)
    if (status === 'done') {
      // H3: worker 先写 results 再写 status，但 TTL 竞态/复制延迟下 status 可能先可见 —
      // 读到 done 而 result 暂空时短等重试（~300ms），而非跳过本轮继续长轮询。
      let raw: string | null = null
      for (let retry = 0; retry < 3; retry++) {
        raw = await redis.get(`kura:results:${jobId}`)
        if (raw) break
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, 100)
        await promise
      }
      if (raw) {
        await redis.del(`kura:results:${jobId}`)
        await redis.del(`kura:job_status:${jobId}`)
        return JSON.parse(raw) as PipelineResult
      }
    }
    if (status === 'error') {
      await redis.del(`kura:job_status:${jobId}`)
      await redis.del(`kura:results:${jobId}`)
      return { status: 'failed', error: 'Job failed' }
    }
    await new Promise(r => setTimeout(r, pollInterval))
  }
  // 超时：status + result 两个 key 都清掉，避免 Redis 泄漏
  await redis.del(`kura:job_status:${jobId}`)
  await redis.del(`kura:results:${jobId}`)
  return null
}
