/**
 * Pipeline worker: background consumer that processes sidecar results.
 *
 * Listens on kura:pending_results queue (fed by sidecar), processes each result
 * through the pipeline (dedup → thumbnails → S3 → DB), and updates Redis with
 * the final status for bot polling.
 */

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

      // Process through pipeline
      const pipeResult = await processResult(sidecarResult, forceRating)

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
