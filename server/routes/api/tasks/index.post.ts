
export default defineEventHandler(async (event) => {
  const apiKey = getHeader(event, 'x-api-key')
  if (!await checkApiKey(apiKey)) throw createError({ statusCode: 401, statusMessage: 'API key required' })

  const body = await readBody<{ source_url: string; source_site?: string; source_id?: string }>(event)
  if (!body?.source_url) throw createError({ statusCode: 400, statusMessage: 'source_url required' })

  const jobId = await enqueueJob({ url: body.source_url, source_site: body.source_site, source_id: body.source_id })
  return { task_id: jobId, status: 'queued' }
})
