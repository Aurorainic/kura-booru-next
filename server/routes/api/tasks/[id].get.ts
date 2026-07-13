export default defineEventHandler(async (event) => {
  const apiKey = getHeader(event, 'x-api-key')
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  // API key OR admin session. Same gate as /api/rebuild — task results contain
  // source URLs/IDs and error strings, so a leaked key = full read access.
  if (!await checkApiKey(apiKey) && !isAdmin) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const id = event.context.params?.id

  // Check job status
  const jobStatus = await redis.get(`kura:job_status:${id}`)
  if (!jobStatus) return { task_id: id, status: 'queued' }
  if (jobStatus === 'processing') return { task_id: id, status: 'processing' }

  // Job is done — read result
  const raw = await redis.get(`kura:results:${id}`)
  if (!raw) return { task_id: id, status: 'queued' }

  const parsed = JSON.parse(raw)

  // Security: strip image_bytes_b64 and phash from public response. phash lives
  // at the top level of SidecarResult (server/utils/queue.ts), not on metadata —
  // a metadata.phash destructure would silently no-op.
  const { image_bytes_b64, phash, ...safeResult } = parsed

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
