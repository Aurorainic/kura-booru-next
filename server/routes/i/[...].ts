export default defineEventHandler(async (event) => {
  const key = event.path.replace(/^\/i\/?/, '')
  const s3Base = process.env.S3_EXTERNAL_URL || ''
  if (!s3Base) {
    return new Response('S3_EXTERNAL_URL not configured', { status: 502 })
  }
  const targetUrl = `${s3Base}/${key}`

  try {
    const resp = await fetch(targetUrl)
    if (!resp.ok) return new Response('S3 error', { status: resp.status })
    // ponytail: stream the body instead of buffering into RAM — large images
    // could OOM the Node process under concurrent load.
    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'content-type': resp.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (e: any) {
    console.error('[i-proxy]', e?.message || e)
    return new Response('S3 unreachable: ' + (e?.message || 'unknown'), { status: 502 })
  }
})
