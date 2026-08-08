import { defineApiKeyHandler } from '../../../platform/http/auth'

function stripTaskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTaskSecrets)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (key === 'image_bytes_b64' || key === 'phash') continue
      out[key] = stripTaskSecrets(item)
    }
    return out
  }
  return value
}

export default defineApiKeyHandler({
  auditAction: 'task status read',
  doc: { method: 'get', path: '/api/tasks/:id', summary: 'Get task status (frozen: status literals + phash strip)' },
  handler: async ({ event }) => {
    const id = event.context.params?.id

    // Check job status
    // ponytail: sidecar sets kura:job_status='processing' while downloading.
    // Extension content.js polls for 'in_progress' — return that string so the
    // polling loop keeps showing "处理中..." instead of falling through to
    // "任务丢失". Without this normalization the status mismatch causes the
    // extension to give up mid-download even though the job is still running.
    const jobStatus = await redis.get(`kura:job_status:${id}`)
    if (!jobStatus) return { task_id: id, status: 'queued' }
    if (jobStatus === 'processing') return { task_id: id, status: 'in_progress' }

    // Job is done — read result
    const raw = await redis.get(`kura:results:${id}`)
    if (!raw) return { task_id: id, status: 'queued' }

    const parsed = JSON.parse(raw)

    // Security: strip image_bytes_b64 and phash recursively. Multi-image
    // results carry both fields inside metadata.pages, so a top-level
    // destructure alone would still leak the raw artwork and perceptual hash.
    const safeResult = stripTaskSecrets(parsed)

    const statusMap: Record<string, string> = {
      ok: 'complete',
      success: 'complete',
      duplicate: 'duplicate',
      too_large: 'too_large',
      error: 'failed',
      failed: 'failed',
    }
    const status = statusMap[parsed.status] || 'failed'
    return { task_id: id, status, result: safeResult }
  },
})
