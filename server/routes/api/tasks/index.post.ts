
// ponytail: sidecar has its own SSRF check (validate_url), but reject obvious
// non-http(s) and private-host URLs at the entry point so we never enqueue
// work we know will be rejected downstream.
async function assertSafeUrl(url: string) {
  let host: string
  try { host = new URL(url).hostname }
  catch { throw createError({ statusCode: 400, statusMessage: 'source_url is not a valid URL' }) }
  if (await isPrivateHost(host)) {
    throw createError({ statusCode: 400, statusMessage: 'source_url points to a private or reserved address' })
  }
}

export default defineEventHandler(async (event) => {
  const apiKey = getHeader(event, 'x-api-key')
  if (!await checkApiKey(apiKey)) throw createError({ statusCode: 401, statusMessage: 'API key required' })

  const body = await readBody<{ source_url: string; source_site?: string; source_id?: string }>(event)
  if (!body?.source_url) throw createError({ statusCode: 400, statusMessage: 'source_url required' })

  await assertSafeUrl(body.source_url)
  const jobId = await enqueueJob({ url: body.source_url, source_site: body.source_site, source_id: body.source_id })
  return { task_id: jobId, status: 'queued' }
})
