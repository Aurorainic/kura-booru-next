/**
 * Pipeline worker: background consumer that processes sidecar results.
 *
 * Listens on kura:pending_results queue (fed by sidecar), processes each result
 * through the pipeline (dedup → thumbnails → S3 → DB), and updates Redis with
 * the final status for bot polling.
 *
 * v0.9.0 R2.4: retry + DLQ (ADR-0001). Pipeline failures retry up to
 * MAX_RETRIES=3 with exponential backoff; exhausted retries push to kura:dlq.
 */

import { MAX_RETRIES, DLQ_KEY } from '../platform/queue'

export default defineNitroPlugin(() => {
  // Don't await — run in background
  startPipelineWorker().catch(err => console.error('[pipeline-worker] fatal:', err))
})

async function startPipelineWorker() {
  console.log('[pipeline-worker] started')

  // Use dedicated connection for blocking BRPOP — shared proxy would deadlock
  const blockRedis = await getBlockingRedis()

  while (true) {
    try {
      // Block until a job ID arrives
      const result = await (blockRedis as any).BRPOP('kura:pending_results', 0)
      if (!result) continue

      // brpop returns [key, element] in node-redis v4+
      const jobId = Array.isArray(result) ? result[1]
        : typeof result === 'string' ? result
        : (result as any)?.element
      if (!jobId) {
        console.warn('[pipeline-worker] empty jobId from brpop')
        continue
      }

      // Read the sidecar result
      const raw = await redis.get(`kura:results:${jobId}`)
      if (!raw) {
        console.warn(`[pipeline-worker] no result for job ${jobId}`)
        continue
      }

      const sidecarResult = JSON.parse(raw)

      // Read optional job metadata (force_rating from extension key path).
      // Best-effort — missing key means default (admin) path.
      let forceRating: 'safe' | 'questionable' | 'explicit' | undefined
      try {
        const metaRaw = await redis.get(`kura:job_meta:${jobId}`)
        if (metaRaw) {
          const meta = JSON.parse(metaRaw)
          if (meta.force_rating === 'safe' || meta.force_rating === 'questionable' || meta.force_rating === 'explicit') {
            forceRating = meta.force_rating
          }
        }
      } catch { /* malformed meta is non-fatal */ }

      // Process through pipeline with retry/DLQ (ADR-0001 §1)
      let pipeResult = await processResultWithRetry(jobId, sidecarResult, forceRating)

      // Overwrite raw sidecar result with safe pipeline result (5 min TTL)
      await (redis as any).set(
        `kura:results:${jobId}`,
        JSON.stringify(pipeResult),
        'EX',
        300,
      )
      // Now set job_status to "done" — pollJobResult can safely read the pipeline result
      await (redis as any).set(`kura:job_status:${jobId}`, 'done', 'EX', 300)

      console.log(`[pipeline-worker] job ${jobId}: ${pipeResult.status}`)
    } catch (err) {
      console.error('[pipeline-worker] error:', err)
      // Brief pause on error to avoid tight loop
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}

/**
 * Wrap processResult with MAX_RETRIES exponential backoff + DLQ.
 * On exhaustion, returns a failed result (so job_status=done + caller unblocks).
 */
async function processResultWithRetry(
  jobId: string,
  sidecarResult: any,
  forceRating?: 'safe' | 'questionable' | 'explicit',
) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await processResult(sidecarResult, forceRating)
      if (result.status !== 'failed' || attempt === MAX_RETRIES) {
        return result
      }
      // Pipeline returned failed — retry with backoff
      console.warn(`[pipeline-worker] job ${jobId} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${result.error}`)
    } catch (err: any) {
      if (attempt === MAX_RETRIES) {
        // Exhausted — DLQ + return failed
        await (redis as any).lpush(DLQ_KEY, JSON.stringify({
          jobId, error: err.message, failedAt: new Date().toISOString(), retryCount: attempt,
        }))
        console.error(`[pipeline-worker] job ${jobId} exhausted ${MAX_RETRIES + 1} attempts → DLQ`)
        return { status: 'failed' as const, error: err.message || 'Pipeline error after retries' }
      }
      console.warn(`[pipeline-worker] job ${jobId} attempt ${attempt + 1}/${MAX_RETRIES + 1} threw: ${err.message}`)
    }
    // Exponential backoff: 1s, 2s, 4s
    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
  }
  // Unreachable, but TS needs it
  return { status: 'failed' as const, error: 'Unreachable' }
}
