import crypto from 'crypto'
import { redis } from './redis'

export interface SidecarJob {
  id: string
  url: string
  source_site?: string
  source_id?: string
  // v0.7.8: if set, pipeline skips auto-rating and uses this verbatim.
  // Restricted to extension key auth path (admin web uses defaults).
  force_rating?: 'safe' | 'questionable' | 'explicit'
}

export interface SidecarResult {
  status: 'ok' | 'error' | 'too_large'
  image_bytes_b64?: string
  phash?: string
  error?: string
  max_size?: number
  metadata?: {
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
  }
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
  await (redis as any).lpush('kura:jobs', JSON.stringify({ id, ...job }))
  // ponytail: persist optional job-level metadata (force_rating) so the
  // pipeline worker can pick it up when processing the sidecar result.
  // Sidecar only sees { url, source_site, source_id } — extra fields would
  // be ignored / dropped.
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
      const raw = await redis.get(`kura:results:${jobId}`)
      if (raw) {
        await redis.del(`kura:results:${jobId}`)
        await redis.del(`kura:job_status:${jobId}`)
        return JSON.parse(raw) as PipelineResult
      }
    }
    if (status === 'error') {
      await redis.del(`kura:job_status:${jobId}`)
      return { status: 'failed', error: 'Job failed' }
    }
    await new Promise(r => setTimeout(r, pollInterval))
  }
  await redis.del(`kura:job_status:${jobId}`)
  return null
}

const MAX_RETRIES = 3

export async function handleJobWithRetry(job: Omit<SidecarJob, 'id'>, retryCount = 0): Promise<PipelineResult | null> {
  const jobId = await enqueueJob(job)
  const result = await pollJobResult(jobId)
  if (result?.status === 'failed' && retryCount < MAX_RETRIES) {
    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retryCount)))
    return handleJobWithRetry(job, retryCount + 1)
  }
  return result
}
