export default defineEventHandler(async (event) => {
  const key = event.path.replace(/^\/i\/?/, '')
  const s3Base = process.env.S3_EXTERNAL_URL || ''
  if (!s3Base) {
    return new Response('S3_EXTERNAL_URL not configured', { status: 502 })
  }
  const targetUrl = `${s3Base}/${key}`

  // Forward Range so S3 returns 206 partial content for image seeks and video
  // previews. ponytail: cache is soft (no `immutable`) because we 302 through
  // here and the underlying S3 key can change on re-upload.
  const reqHeaders: Record<string, string> = {}
  const range = getRequestHeader(event, 'range')
  if (range) reqHeaders['Range'] = range

  try {
    const resp = await fetch(targetUrl, { headers: reqHeaders })
    if (!resp.ok && resp.status !== 206) return new Response('S3 error', { status: resp.status })
    // ponytail: stream the body instead of buffering into RAM — large images
    // could OOM the Node process under concurrent load.
    const outHeaders: Record<string, string> = {
      'content-type': resp.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000',
    }
    for (const h of ['content-range', 'accept-ranges', 'content-length']) {
      const v = resp.headers.get(h)
      if (v) outHeaders[h] = v
    }
    return new Response(resp.body, {
      status: resp.status,
      headers: outHeaders,
    })
  } catch (e: any) {
    console.error('[i-proxy]', e?.message || e)
    return new Response('S3 unreachable: ' + (e?.message || 'unknown'), { status: 502 })
  }
})
