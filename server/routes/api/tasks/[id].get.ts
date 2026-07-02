export default defineEventHandler(async (event) => {
  const apiKey = getHeader(event, 'x-api-key')
  if (!await checkApiKey(apiKey)) throw createError({ statusCode: 401, statusMessage: 'API key required' })

  const id = event.context.params?.id as string

  // Check job status
  const jobStatus = await redis.get(`kura:job_status:${id}`)
  if (!jobStatus) return { task_id: id, status: 'queued' }
  if (jobStatus === 'processing') return { task_id: id, status: 'processing' }

  // Job is done — read result
  const raw = await redis.get(`kura:results:${id}`)
  if (!raw) return { task_id: id, status: 'queued' }

  const parsed = JSON.parse(raw)

  // Security: strip image_bytes_b64 and phash from public response
  const { image_bytes_b64, phash, ...safeResult } = parsed
  // Also strip from metadata if present
  if (safeResult.metadata?.phash) {
    const { phash: _, ...safeMeta } = safeResult.metadata
    safeResult.metadata = safeMeta
  }

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
})
