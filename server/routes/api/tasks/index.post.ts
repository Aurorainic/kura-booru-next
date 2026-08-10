
async function assertSafeUrl(url: string) {
  let parsed: URL
  try { parsed = new URL(url) }
  catch { throw new AppError('VALIDATION_FAILED', 400, 'source_url is not a valid URL') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('VALIDATION_FAILED', 400, 'source_url must use http or https')
  }
  const host = parsed.hostname
  if (await isPrivateHost(host)) {
    throw new AppError('VALIDATION_FAILED', 400, 'source_url points to a private or reserved address')
  }
}

import { defineApiKeyHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'

export default defineApiKeyHandler({
  auditAction: 'task create',
  doc: { method: 'post', path: '/api/tasks', summary: 'Create import task (session or apikey)' },
  handler: async ({ event }) => {
    const body = await readBody<{ source_url: string; source_site?: string; source_id?: string }>(event)
    if (!body?.source_url) throw new AppError('VALIDATION_FAILED', 400, 'source_url required')

    await assertSafeUrl(body.source_url)
    const jobId = await enqueueJob({ url: body.source_url, source_site: body.source_site, source_id: body.source_id })
    return { task_id: jobId, status: 'queued' }
  },
})
